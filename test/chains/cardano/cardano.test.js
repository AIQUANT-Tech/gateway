// test/chains/cardano/cardano.test.js

const fs = require('fs');
const path = require('path');

const { test, describe, expect, beforeEach } = require('@jest/globals');
const axios = require('axios');

// Constants for this test file
const CHAIN = 'cardano';
const NETWORK = 'preprod'; // for balance‐endpoint only
const TEST_WALLET = 'addr_test1vrvqa7ytgmptew2qy3ec0lqdk9n94vcgwu4wy07kqp2he0srll8mg';

// Mock API calls
jest.mock('axios');

// Helper to load mock responses
function loadMockResponse(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'mocks', `${name}.json`), 'utf8'));
}

// Validate balance response shape
function validateBalanceResponse(resp) {
  return (
    resp &&
    typeof resp.network === 'string' &&
    typeof resp.wallet === 'string' &&
    Array.isArray(resp.balances) &&
    resp.balances.every(
      (b) =>
        ['symbol', 'address', 'name', 'balance'].every((k) => typeof b[k] === 'string') &&
        typeof b.decimals === 'number',
    )
  );
}

describe('Cardano Chain Tests (Preprod Network)', () => {
  beforeEach(() => {
    axios.get = jest.fn();
    axios.post = jest.fn();
  });

  describe('Balance Endpoint', () => {
    test('returns and validates wallet balances', async () => {
      const mockResponse = loadMockResponse('balance');

      axios.get.mockResolvedValueOnce({
        status: 200,
        data: mockResponse,
      });

      const response = await axios.get(`http://localhost:15888/chains/${CHAIN}/balances`, {
        params: {
          network: NETWORK,
          wallet: TEST_WALLET,
          tokens: ['ADA', 'MIN', 'LP'],
        },
      });

      expect(response.status).toBe(200);
      expect(validateBalanceResponse(response.data)).toBe(true);

      // must match the fixture exactly
      expect(response.data.network).toBe(mockResponse.network);
      expect(response.data.wallet).toBe(mockResponse.wallet);
      expect(response.data.balances).toHaveLength(mockResponse.balances.length);

      expect(axios.get).toHaveBeenCalledWith(
        `http://localhost:15888/chains/${CHAIN}/balances`,
        expect.objectContaining({
          params: {
            network: NETWORK,
            wallet: TEST_WALLET,
            tokens: ['ADA', 'MIN', 'LP'],
          },
        }),
      );
    });

    test('handles error response for invalid wallet', async () => {
      axios.get.mockRejectedValueOnce({
        response: {
          status: 400,
          data: { error: 'Invalid wallet address', code: 400 },
        },
      });

      await expect(
        axios.get(`http://localhost:15888/chains/${CHAIN}/balances`, {
          params: { network: NETWORK, wallet: 'invalid', tokens: ['ADA'] },
        }),
      ).rejects.toMatchObject({
        response: {
          status: 400,
          data: { error: 'Invalid wallet address' },
        },
      });
    });
  });

  describe('Tokens Endpoint', () => {
    test('returns and validates token list', async () => {
      const mockResponse = loadMockResponse('tokens');

      axios.get.mockResolvedValueOnce({ status: 200, data: mockResponse });

      const response = await axios.get(`http://localhost:15888/chains/${CHAIN}/tokens`, {
        params: { network: mockResponse.network },
      });

      expect(response.status).toBe(200);
      expect(Array.isArray(response.data.tokens)).toBe(true);
      response.data.tokens.forEach((t) => {
        expect(typeof t.symbol).toBe('string');
        expect(typeof t.address).toBe('string');
        expect(typeof t.decimals).toBe('number');
        expect(typeof t.name).toBe('string');
      });

      // derive network from the fixture
      if ('network' in mockResponse) {
        expect(response.data.network).toBe(mockResponse.network);
      }
      expect(response.data.tokens.length).toBeGreaterThan(0);

      expect(axios.get).toHaveBeenCalledWith(
        `http://localhost:15888/chains/${CHAIN}/tokens`,
        expect.objectContaining({
          params: { network: mockResponse.network },
        }),
      );
    });
  });

  describe('Status Endpoint', () => {
    test('returns and validates chain status', async () => {
      const mockResponse = loadMockResponse('status');

      axios.get.mockResolvedValueOnce({ status: 200, data: mockResponse });

      const response = await axios.get(`http://localhost:15888/chains/${CHAIN}/status`, {
        params: { network: mockResponse.network },
      });

      expect(response.status).toBe(200);

      if ('network' in mockResponse) {
        expect(response.data.network).toBe(mockResponse.network);
      }

      if ('chain' in mockResponse) {
        expect(response.data.chain).toBe(mockResponse.chain);
      }

      if ('latestBlock' in mockResponse) {
        expect(typeof response.data.latestBlock).toBe('number');
      }

      if ('rpcUrl' in mockResponse) {
        expect(typeof response.data.rpcUrl).toBe('string');
      }

      if ('nativeCurrency' in mockResponse) {
        expect(response.data.nativeCurrency).toBe('ADA');
      }

      expect(axios.get).toHaveBeenCalledWith(
        `http://localhost:15888/chains/${CHAIN}/status`,
        expect.objectContaining({
          params: { network: mockResponse.network },
        }),
      );
    });
  });
  // Add these to your cardano.test.js file

  describe('Poll Endpoint', () => {
    test('returns and validates transaction poll response', async () => {
      const mockResponse = loadMockResponse('poll');

      axios.post.mockResolvedValueOnce({ status: 200, data: mockResponse });

      const response = await axios.post(`http://localhost:15888/chains/${CHAIN}/poll`, {
        network: NETWORK,
        signature: '66f5f15d15124a77418cfa3ec0e72cc1d2295647e528a9ecb4636f9ed5342d06',
      });

      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('currentBlock');
      expect(response.data).toHaveProperty('signature');
      expect(response.data).toHaveProperty('txBlock');
      expect(response.data).toHaveProperty('txStatus');
      expect(response.data).toHaveProperty('txData');
      expect(response.data).toHaveProperty('fee');

      // Validate types
      expect(typeof response.data.currentBlock).toBe('number');
      expect(typeof response.data.signature).toBe('string');

      if (response.data.txBlock !== null) {
        expect(typeof response.data.txBlock).toBe('number');
      }

      expect(typeof response.data.txStatus).toBe('number');
      expect([0, 1]).toContain(response.data.txStatus); // 0 = pending/failed, 1 = success

      // Validate fee format if present
      if (response.data.fee !== null) {
        expect(typeof response.data.fee).toBe('string');
      }

      expect(axios.post).toHaveBeenCalledWith(
        `http://localhost:15888/chains/${CHAIN}/poll`,
        expect.objectContaining({
          network: NETWORK,
          signature: expect.any(String),
        }),
      );
    });

    test('handles error for invalid transaction signature', async () => {
      const mockErrorResponse = {
        currentBlock: 12345678,
        signature: 'invalid-signature',
        txBlock: null,
        txStatus: 0,
        txData: null,
        fee: null,
        error: 'Invalid transaction signature format',
      };

      axios.post.mockResolvedValueOnce({
        status: 200,
        data: mockErrorResponse,
      });

      const response = await axios.post(`http://localhost:15888/chains/${CHAIN}/poll`, {
        network: NETWORK,
        signature: 'invalid-signature',
      });

      expect(response.status).toBe(200);
      expect(response.data.txStatus).toBe(0);
      expect(response.data.txBlock).toBeNull();
      expect(response.data.error).toBeDefined();
      expect(typeof response.data.error).toBe('string');
    });
  });

  describe('Estimate Gas Endpoint', () => {
    test('returns and validates gas estimate for simple transaction', async () => {
      const mockResponse = loadMockResponse('estimate-gas');

      axios.get.mockResolvedValueOnce({ status: 200, data: mockResponse });

      const response = await axios.get(`http://localhost:15888/chains/${CHAIN}/estimate-gas`, {
        params: { network: NETWORK },
      });

      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('feePerComputeUnit');
      expect(response.data).toHaveProperty('denomination');
      expect(response.data).toHaveProperty('computeUnits');
      expect(response.data).toHaveProperty('feeAsset');
      expect(response.data).toHaveProperty('fee');
      expect(response.data).toHaveProperty('timestamp');

      // Validate types
      expect(typeof response.data.feePerComputeUnit).toBe('number');
      expect(response.data.denomination).toBe('lovelace');
      expect(typeof response.data.computeUnits).toBe('number');
      expect(response.data.feeAsset).toBe('ADA');
      expect(typeof response.data.fee).toBe('number');
      expect(typeof response.data.timestamp).toBe('number');

      // Validate reasonable values
      expect(response.data.feePerComputeUnit).toBeGreaterThan(0);
      expect(response.data.computeUnits).toBeGreaterThan(0);
      expect(response.data.fee).toBeGreaterThan(0);

      // Simple transactions should be relatively cheap (< 1 ADA)
      expect(response.data.fee).toBeLessThan(1);

      expect(axios.get).toHaveBeenCalledWith(
        `http://localhost:15888/chains/${CHAIN}/estimate-gas`,
        expect.objectContaining({
          params: { network: NETWORK },
        }),
      );
    });

    test('handles error when network is unavailable', async () => {
      axios.get.mockRejectedValueOnce({
        response: {
          status: 500,
          data: {
            error: 'Error estimating Cardano fee for network invalid-network',
            code: 500,
          },
        },
      });

      await expect(
        axios.get(`http://localhost:15888/chains/${CHAIN}/estimate-gas`, {
          params: { network: 'invalid-network' },
        }),
      ).rejects.toMatchObject({
        response: {
          status: 500,
          data: {
            error: expect.stringContaining('Error estimating Cardano fee'),
          },
        },
      });
    });
  });
});
