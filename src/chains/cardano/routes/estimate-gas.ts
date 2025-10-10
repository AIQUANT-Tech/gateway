import Decimal from 'decimal.js';
import { FastifyPluginAsync, FastifyInstance } from 'fastify';

import {
  EstimateGasRequestSchema,
  EstimateGasRequestType,
  EstimateGasResponse,
  EstimateGasResponseSchema,
} from '../../../schemas/chain-schema';
import { logger } from '../../../services/logger';
import { Cardano } from '../cardano';
import { ExecutionUnits } from '../cardano.utils';

export async function estimateGasCardano(
  fastify: FastifyInstance,
  network: string,
  transactionType: 'simple' | 'swap' | 'contract' = 'simple',
): Promise<EstimateGasResponse> {
  try {
    // 1. Fetch protocol parameters
    const cardano = await Cardano.getInstance(network);
    const params = await cardano.getProtocolParameters();

    // Convert to BigInt (lovelace is integer)
    const minFeeA = BigInt(params.min_fee_a); // e.g., 44 lovelace/byte
    const minFeeB = BigInt(params.min_fee_b); // e.g., 155381 lovelace
    console.log('Fees:' + minFeeA + ' ' + minFeeB);

    const priceMemRaw = params.price_mem || '0.0577'; // Default in lovelace per mem unit
    const priceStepsRaw = params.price_steps || '0.0000721'; // Default in lovelace per CPU step

    const priceMemDecimal = new Decimal(priceMemRaw).times(1_000_000);
    const priceStepsDecimal = new Decimal(priceStepsRaw).times(1_000_000);

    const priceMem = BigInt(priceMemDecimal.toFixed(0));
    const priceSteps = BigInt(priceStepsDecimal.toFixed(0));

    console.log('Prices:', priceMem.toString(), priceSteps.toString());

    // 2. Estimate transaction sizes based on type (in bytes)
    // These are empirical estimates; real size requires serialization
    const TX_SIZE_ESTIMATES = {
      simple: 300n, // Simple ADA transfer (1-2 inputs, 1-2 outputs)
      swap: 16000n, // DEX swap with Plutus script + datum + redeemer
      contract: 20000n, // Complex contract interaction
    };

    const txSizeBytes = TX_SIZE_ESTIMATES[transactionType] || TX_SIZE_ESTIMATES.swap;

    // 3. Calculate base fee: fee = a * txSize + b
    const baseFeeLovelace = minFeeA * txSizeBytes + minFeeB;

    // 4. Estimate Plutus execution costs for smart contract transactions
    let scriptFeeLovelace = 0n;

    if (transactionType === 'swap' || transactionType === 'contract') {
      // Typical execution units for DEX swaps (empirical averages from Minswap/SundaeSwap)
      const executionUnits: ExecutionUnits = {
        mem: 14000000n, // ~14M memory units typical for swaps
        steps: 10000000000n, // ~10B CPU steps typical for swaps
      };

      // Script fee = (priceMem * mem) + (priceSteps * steps)
      scriptFeeLovelace =
        (priceMem * executionUnits.mem) / 1_000_000n + (priceSteps * executionUnits.steps) / 1_000_000n;
    }

    // 5. Total fee
    const totalFeeLovelace = baseFeeLovelace + scriptFeeLovelace;
    const totalFeeAda = Number(totalFeeLovelace) / 1_000_000;

    logger.info(`Cardano fee estimate for ${transactionType}: ${totalFeeAda} ADA (${totalFeeLovelace} lovelace)`);

    return {
      feePerComputeUnit: Number(minFeeA), // lovelace per byte
      denomination: 'lovelace',
      computeUnits: Number(txSizeBytes), // transaction size in bytes
      feeAsset: 'ADA',
      fee: totalFeeAda,
      timestamp: Date.now(),
    };
  } catch (error) {
    try {
      logger.error(`Error estimating Cardano fee for network ${network}: ${error.message}`);

      // Fallback calculation using hardcoded values
      const fallbackMinFeeA = 44n;
      const fallbackMinFeeB = 155381n;
      const fallbackSize = 16000n; // Assume swap transaction

      // Base fee only (no script execution)
      const fallbackBaseFee = fallbackMinFeeA * fallbackSize + fallbackMinFeeB;

      // Add typical script execution cost (~2 ADA for safety)
      const fallbackScriptFee = 2_000_000n; // 2 ADA in lovelace
      const fallbackTotalFee = fallbackBaseFee + fallbackScriptFee;
      const fallbackFeeAda = Number(fallbackTotalFee) / 1_000_000;

      return {
        feePerComputeUnit: 44,
        denomination: 'lovelace',
        computeUnits: 16000,
        feeAsset: 'ADA',
        fee: fallbackFeeAda,
        timestamp: Date.now(),
      };
    } catch (instanceError) {
      logger.error(`Error estimating Cardano fee for network ${network}: ${instanceError.message}`);
      throw fastify.httpErrors.internalServerError(
        `Error estimating Cardano fee for network ${network}: ${error.message}`,
      );
    }
  }
}

export const estimateGasRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get<{
    Querystring: EstimateGasRequestType;
    Reply: EstimateGasResponse;
  }>(
    '/estimate-gas',
    {
      schema: {
        description: 'Estimate transaction fees for Cardano (includes base fee + Plutus execution costs)',
        tags: ['/chain/cardano'],
        querystring: EstimateGasRequestSchema,
        response: {
          200: EstimateGasResponseSchema,
        },
      },
    },
    async (request) => {
      const { network } = request.query;
      return await estimateGasCardano(fastify, network || 'mainnet');
    },
  );
};

export default estimateGasRoute;
