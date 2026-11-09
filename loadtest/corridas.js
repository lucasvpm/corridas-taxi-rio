// Teste de carga do fluxo completo de uma corrida.
// Rodar: docker compose --profile loadtest run --rm k6
// Variáveis: BASE_URL (default http://api:3000), VUS (default 20), DURATION (default 1m).
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const VUS = Number(__ENV.VUS || 20);
const DURATION = __ENV.DURATION || '1m';
const tokens = JSON.parse(open('/keys/tokens.json'));

// Quanto tempo o GET (que lê do cache atualizado pelo worker) leva para refletir o PATCH.
const cacheConvergence = new Trend('cache_convergence_ms', true);
const cacheStale = new Counter('cache_never_converged');

export const options = {
  scenarios: {
    fluxo_corrida: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '20s', target: VUS },
        { duration: DURATION, target: VUS },
        { duration: '10s', target: 0 },
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{name:POST /corridas}': ['p(95)<300'],
    'http_req_duration{name:GET /corridas/:id}': ['p(95)<150'],
    'http_req_duration{name:PATCH /corridas/:id/status}': ['p(95)<300'],
    cache_convergence_ms: ['p(95)<2000'],
    checks: ['rate>0.99'],
  },
};

/** Monta headers JSON + Authorization. */
function headers(token, extra = {}) {
  return { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...extra } };
}

/** Uma iteração = ciclo de vida completo de uma corrida + um replay idempotente. */
export default function () {
  const passageiro = __VU % 2 === 0 ? tokens.passageiro_1 : tokens.passageiro_2;
  const motorista = __VU % 2 === 0 ? tokens.motorista_1 : tokens.motorista_2;
  const key = `k6-${__VU}-${__ITER}-${Date.now()}`;
  const body = JSON.stringify({ origem: 'Copacabana', destino: 'Aeroporto Santos Dumont' });

  const criada = http.post(`${BASE_URL}/corridas`, body, {
    ...headers(passageiro, { 'Idempotency-Key': key }),
    tags: { name: 'POST /corridas' },
  });
  if (!check(criada, { 'POST 201': (r) => r.status === 201 })) return;
  const id = criada.json('id');

  const replay = http.post(`${BASE_URL}/corridas`, body, {
    ...headers(passageiro, { 'Idempotency-Key': key }),
    tags: { name: 'POST /corridas (replay)' },
  });
  check(replay, { 'replay 200 mesmo id': (r) => r.status === 200 && r.json('id') === id });

  const get = (tag) =>
    http.get(`${BASE_URL}/corridas/${id}`, { ...headers(passageiro), tags: { name: tag || 'GET /corridas/:id' } });
  check(get(), { 'GET 200': (r) => r.status === 200 });

  for (const status of ['ACEITA', 'EM_ANDAMENTO', 'FINALIZADA']) {
    const r = http.patch(`${BASE_URL}/corridas/${id}/status`, JSON.stringify({ status }), {
      ...headers(motorista),
      tags: { name: 'PATCH /corridas/:id/status' },
    });
    check(r, { [`PATCH ${status} 200`]: (res) => res.status === 200 });
    sleep(0.2);
  }

  // Mede a convergência do cache: GET até ver FINALIZADA (o worker precisa processar o evento).
  const start = Date.now();
  let converged = false;
  for (let i = 0; i < 25 && !converged; i++) {
    const r = get('GET /corridas/:id (convergencia)');
    converged = r.status === 200 && r.json('status') === 'FINALIZADA';
    if (!converged) sleep(0.2);
  }
  if (converged) cacheConvergence.add(Date.now() - start);
  else cacheStale.add(1);
  check(converged, { 'cache convergiu para FINALIZADA': (c) => c === true });

  sleep(0.5);
}
