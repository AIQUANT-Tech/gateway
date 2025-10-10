import { FastifyPluginAsync } from 'fastify';

import {
  GetPositionInfoRequestType,
  GetPositionInfoRequest,
  PositionInfo,
  PositionInfoSchema,
} from '../../../schemas/amm-schema';
import { logger } from '../../../services/logger';
import { Minswap } from '../minswap';

export const positionInfoRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get<{
    Querystring: GetPositionInfoRequestType;
    Reply: PositionInfo;
  }>(
    '/position-info',
    {
      schema: {
        description: 'Get position information for a Minswap AMM pool',
        tags: ['/connector/minswap/amm'],
        querystring: {
          ...GetPositionInfoRequest,
          properties: {
            network: { type: 'string', default: 'preprod' },
            walletAddress: { type: 'string', examples: ['addr_test1234'] },
            poolAddress: { type: 'string', examples: ['pool1...'] },
            baseToken: { type: 'string', examples: ['ADA'] },
            quoteToken: { type: 'string', examples: ['MIN'] },
          },
        },
        response: {
          200: PositionInfoSchema,
        },
      },
    },
    async (request) => {
      try {
        const { network = 'preprod', poolAddress, walletAddress: requestedWalletAddress } = request.query;

        if (!poolAddress) {
          throw fastify.httpErrors.badRequest('Pool address is required');
        }

        if (!requestedWalletAddress) {
          throw fastify.httpErrors.badRequest('Wallet address is required');
        }

        // 2) Prepare Minswap
        const minswap = await Minswap.getInstance(network);
        const { cardano } = minswap;

        // 3) Ensure wallet key
        const privateKey = await cardano.getWalletFromAddress(requestedWalletAddress);
        if (!privateKey) {
          throw fastify.httpErrors.badRequest('Wallet not found');
        }
        cardano.lucidInstance.selectWalletFromPrivateKey(privateKey);

        // Fetch pool data on-chain (state and datum)
        const { poolState, poolDatum } = await minswap.getPoolData(poolAddress);

        if (!poolState || !poolDatum) {
          throw fastify.httpErrors.notFound('Pool data not found');
        }
        const poolInfo = await minswap.getAmmPoolInfo(poolAddress);

        const baseTokenAddress = poolInfo.baseTokenAddress;
        const quoteTokenAddress = poolInfo.quoteTokenAddress;
        const baseToken = await minswap.cardano.getTokenByAddress(baseTokenAddress);
        const quoteToken = await minswap.cardano.getTokenByAddress(quoteTokenAddress);

        // Fetch LP token balance for the wallet
        const utxos = await minswap.cardano.lucidInstance.utxosAt(requestedWalletAddress);
        const totalLpInWallet = minswap.calculateAssetAmount(utxos, poolState.assetLP);
        const lpBalance = BigInt(totalLpInWallet);
        if (lpBalance === 0n) {
          // Return empty position data early
          return {
            poolAddress,
            walletAddress: requestedWalletAddress,
            baseTokenAddress: poolState.assetA,
            quoteTokenAddress: poolState.assetB,
            lpTokenAmount: 0,
            baseTokenAmount: 0,
            quoteTokenAmount: 0,
            price: 0,
          };
        }

        // Calculate user's share of the pool
        const userShare = Number(lpBalance) / Number(poolDatum.totalLiquidity);

        // Calculate user token amounts based on reserves and lp token balance
        const baseTokenAmount = (userShare * Number(poolState.reserveA)) / 10 ** baseToken.decimals;
        const quoteTokenAmount = (userShare * Number(poolState.reserveB)) / 10 ** quoteToken.decimals;

        return {
          poolAddress,
          walletAddress: requestedWalletAddress,
          baseTokenAddress: poolState.assetA,
          quoteTokenAddress: poolState.assetB,
          lpTokenAmount: Number(lpBalance),
          baseTokenAmount,
          quoteTokenAmount,
          price: poolInfo.price,
        };
      } catch (e: any) {
        logger.error(e);
        if (e.statusCode) {
          throw e;
        }
        throw fastify.httpErrors.internalServerError('Failed to get position info');
      }
    },
  );
};
