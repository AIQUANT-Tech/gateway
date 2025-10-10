import { FastifyPluginAsync } from 'fastify';

import { balancesRoute } from './routes/balances';
import { estimateGasRoute } from './routes/estimate-gas';
import { pollRoute } from './routes/poll';
import { statusRoute } from './routes/status';
import { tokensRoute } from './routes/tokens';

export const cardanoRoutes: FastifyPluginAsync = async (fastify) => {
  // Register all the route handlers
  fastify.register(statusRoute);
  fastify.register(tokensRoute);
  fastify.register(balancesRoute);
  fastify.register(estimateGasRoute);
  fastify.register(pollRoute);
};

export default cardanoRoutes;
