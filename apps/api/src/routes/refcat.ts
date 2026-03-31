import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

const ENGINE_URL = process.env.ENGINE_URL || 'http://geotwin-engine:8002';

interface RefcatBody {
  refcat: string;
}

/**
 * Referencia Catastral API — creates a digital twin from a Spanish cadastral reference.
 */
export async function refcatRouter(fastify: FastifyInstance) {

  // POST /api/twin/from-refcat — Start autotwin pipeline from referencia catastral
  fastify.post('/twin/from-refcat', {
    schema: {
      body: {
        type: 'object',
        required: ['refcat'],
        properties: {
          refcat: {
            type: 'string',
            minLength: 14,
            maxLength: 20,
            pattern: '^[A-Za-z0-9]+$',
          },
        },
      },
    },
  }, async (request: FastifyRequest<{ Body: RefcatBody }>, reply: FastifyReply) => {
    const { refcat } = request.body;

    // Forward to engine's /autotwin endpoint
    try {
      const resp = await fetch(`${ENGINE_URL}/autotwin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refcat }),
      });

      if (!resp.ok) {
        const error = await resp.text();
        return reply.code(resp.status).send({
          error: `Engine error: ${error}`,
        });
      }

      const result = await resp.json() as { job_id: string; twin_id: string; refcat: string; status: string };
      return reply.code(202).send(result);
    } catch (err) {
      fastify.log.error('Engine /autotwin call failed: %s', err);
      return reply.code(502).send({
        error: 'Engine service unavailable',
      });
    }
  });

  // GET /api/twin/from-refcat/:jobId — Poll autotwin job status
  fastify.get('/twin/from-refcat/:jobId', async (request: FastifyRequest, reply: FastifyReply) => {
    const { jobId } = request.params as { jobId: string };

    if (!/^[a-f0-9]{12}$/.test(jobId)) {
      return reply.code(400).send({ error: 'Invalid jobId' });
    }

    try {
      const resp = await fetch(`${ENGINE_URL}/jobs/${jobId}`);
      if (!resp.ok) {
        return reply.code(resp.status).send({ error: 'Job not found' });
      }

      const job = await resp.json();
      return reply.send(job);
    } catch (err) {
      return reply.code(502).send({ error: 'Engine service unavailable' });
    }
  });
}
