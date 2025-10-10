import { FastifyPluginAsync } from 'fastify';

import {
  GetPositionInfoRequestType,
  GetPositionInfoRequest,
  PositionInfo,
  PositionInfoSchema,
} from '../../../schemas/amm-schema';
import { logger } from '../../../services/logger';
import { Sundaeswap } from '../sundaeswap';

export const positionInfoRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get<{
    Querystring: GetPositionInfoRequestType;
    Reply: PositionInfo;
  }>(
    '/position-info',
    {
      schema: {
        description: 'Get position information for a Sundaeswap AMM pool',
        tags: ['/connector/sundaeswap/amm'],
        querystring: {
          ...GetPositionInfoRequest,
          properties: {
            network: { type: 'string', default: 'mainnet' },
            walletAddress: { type: 'string', examples: ['addr1v8vqa7ytgmptew2qy3ec0lqdk9n94vcgwu4wy07kqp2he0schtm5d'] },
            poolAddress: { type: 'string', examples: ['2f36866691fa75a9aab66dec99f7cc2d297ca09e34d9ce68cde04773'] },
            baseToken: { type: 'string', examples: ['ADA'] },
            quoteToken: { type: 'string', examples: ['SBERRY'] },
          },
        },
        response: {
          200: PositionInfoSchema,
        },
      },
    },
    async (request) => {
      try {
        const { network = 'mainnet', poolAddress, walletAddress: requestedWalletAddress } = request.query;

        if (!poolAddress) {
          throw fastify.httpErrors.badRequest('Pool address is required');
        }

        if (!requestedWalletAddress) {
          throw fastify.httpErrors.badRequest('Wallet address is required');
        }

        // 2) Prepare Sundaeswap
        const sundaeswap = await Sundaeswap.getInstance(network);
        const { cardano } = sundaeswap;

        // 3) Ensure wallet key
        const privateKey = await cardano.getWalletFromAddress(requestedWalletAddress);
        if (!privateKey) {
          throw fastify.httpErrors.badRequest('Wallet not found');
        }
        cardano.lucidInstance.selectWalletFromPrivateKey(privateKey);

        // Fetch pool data on-chain (state and datum)
        const poolInfo = await sundaeswap.getAmmPoolInfo(poolAddress);

        const baseTokenAddress = poolInfo.baseTokenAddress;
        const quoteTokenAddress = poolInfo.quoteTokenAddress;

        const baseToken = await sundaeswap.cardano.getTokenByAddress(baseTokenAddress);
        const quoteToken = await sundaeswap.cardano.getTokenByAddress(quoteTokenAddress);

        // Fetch LP token balance for the wallet
        const utxos = await sundaeswap.cardano.lucidInstance.utxosAt(requestedWalletAddress);
        const poolData = await sundaeswap.getPoolData(poolAddress);
        const totalLpInWallet = sundaeswap.calculateAssetAmount(utxos, poolData.assetLP);
        const lpBalance = BigInt(totalLpInWallet);
        if (lpBalance === 0n) {
          // Return empty position data early
          return {
            poolAddress,
            walletAddress: requestedWalletAddress,
            baseTokenAddress: poolInfo.baseTokenAddress,
            quoteTokenAddress: poolInfo.quoteTokenAddress,
            lpTokenAmount: 0,
            baseTokenAmount: 0,
            quoteTokenAmount: 0,
            price: 0,
          };
        }

        // Calculate user's share of the pool
        const userShare = Number(lpBalance) / Number(poolData.liquidity.lpTotal);

        // Calculate user token amounts based on reserves and lp token balance
        const baseTokenAmount = (userShare * Number(poolData.liquidity.aReserve)) / 10 ** baseToken.decimals;
        const quoteTokenAmount = (userShare * Number(poolData.liquidity.bReserve)) / 10 ** quoteToken.decimals;

        return {
          poolAddress,
          walletAddress: requestedWalletAddress,
          baseTokenAddress: poolInfo.baseTokenAddress,
          quoteTokenAddress: poolInfo.quoteTokenAddress,
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
