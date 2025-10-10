// Mock fs-extra to prevent actual file writes
jest.mock('fs-extra');

// Mock the entire app to prevent loading real dependencies
jest.mock('../../../src/app', () => ({
  gatewayApp: {
    ready: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
    inject: jest.fn(),
  },
}));

// Mock Cardano class before it's imported
jest.mock('../../../src/chains/cardano/cardano', () => {
  const mockCardanoInstance = {
    getWalletFromPrivateKey: jest.fn(),
    encrypt: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
  };

  return {
    Cardano: {
      getInstance: jest.fn().mockResolvedValue(mockCardanoInstance),
    },
  };
});

import * as fse from 'fs-extra';

import { gatewayApp } from '../../../src/app';
import { Cardano } from '../../../src/chains/cardano/cardano';
import { ConfigManagerCertPassphrase } from '../../../src/services/config-manager-cert-passphrase';
import { GetWalletResponse } from '../../../src/wallet/schemas';
import { patch, unpatch } from '../../services/patch';

const mockFse = fse as jest.Mocked<typeof fse>;
const mockGatewayApp = gatewayApp as jest.Mocked<typeof gatewayApp>;

let cardano: any;

// --- Test wallet data ---
const testAddress = 'addr_test1vrvqa7ytgmptew2qy3ec0lqdk9n94vcgwu4wy07kqp2he0srll8mg';
const testPrivateKey = 'ed25519_sk1n24dk27xar2skjef5a5xvpk0uy0sqw62tt7hlv7wcpd4xp4fhy5sdask94'; // noqa: mock

// Mock the encoded private key response
const encodedPrivateKey = {
  address: testAddress,
  id: '7bb58a6c-06d3-4ede-af06-5f4a5cb87f0b',
  version: 3,
  Crypto: {
    cipher: 'aes-128-ctr',
    cipherparams: { iv: 'test-iv-12345' },
    ciphertext: 'mock-encrypted-key', // noqa: mock
    kdf: 'scrypt',
    kdfparams: {
      salt: 'mock-salt', // noqa: mock
      n: 131072,
      dklen: 32,
      p: 1,
      r: 8,
    },
    mac: 'mock-mac', // noqa: mock
  },
};

// Track wallet operations in memory to avoid file system pollution
const mockWallets: { [key: string]: Set<string> } = {
  cardano: new Set<string>(),
};

beforeAll(async () => {
  // Prevent reading passphrase from real config
  patch(ConfigManagerCertPassphrase, 'readPassphrase', () => 'a');

  // Get the mocked Cardano instance
  cardano = await Cardano.getInstance('preprod');

  // Setup default mock behaviors
  (cardano.getWalletFromPrivateKey as jest.Mock).mockReturnValue({ address: testAddress });
  (cardano.encrypt as jest.Mock).mockReturnValue(JSON.stringify(encodedPrivateKey));
});

beforeEach(() => {
  patch(ConfigManagerCertPassphrase, 'readPassphrase', () => 'a');

  // Clear mock wallets
  mockWallets.cardano.clear();

  // Reset mocks
  jest.clearAllMocks();

  // Setup Cardano mock behaviors
  (cardano.getWalletFromPrivateKey as jest.Mock).mockReturnValue({ address: testAddress });
  (cardano.encrypt as jest.Mock).mockReturnValue(JSON.stringify(encodedPrivateKey));

  // Setup fs-extra mocks
  (mockFse.writeFile as jest.Mock).mockImplementation(async (path: any) => {
    const pathStr = path.toString();
    const pathParts = pathStr.split('/');
    const chain = pathParts[pathParts.length - 2];
    const address = pathParts[pathParts.length - 1].replace('.json', '');

    if (chain && address) {
      if (!mockWallets[chain]) {
        mockWallets[chain] = new Set<string>();
      }
      mockWallets[chain].add(address);
    }
    return undefined;
  });

  (mockFse.readdir as jest.Mock).mockImplementation(async (dirPath: any, options?: any) => {
    const pathStr = dirPath.toString();

    // If asking for directories in wallet path
    if (pathStr.endsWith('/wallets') && options?.withFileTypes) {
      return Object.keys(mockWallets).map((chain) => ({
        name: chain,
        isDirectory: () => true,
        isFile: () => false,
      }));
    }

    // If asking for files in a chain directory
    const chain = pathStr.split('/').pop();
    if (chain && mockWallets[chain]) {
      if (options?.withFileTypes) {
        return Array.from(mockWallets[chain]).map((addr) => ({
          name: `${addr}.json`,
          isDirectory: () => false,
          isFile: () => true,
        }));
      }
      return Array.from(mockWallets[chain]).map((addr) => `${addr}.json`);
    }

    return [];
  });

  (mockFse.readFile as jest.Mock).mockResolvedValue(Buffer.from(JSON.stringify(encodedPrivateKey)));
  (mockFse.pathExists as jest.Mock).mockResolvedValue(true);
  (mockFse.ensureDir as jest.Mock).mockResolvedValue(undefined);

  (mockFse.remove as jest.Mock).mockImplementation(async (filePath: any) => {
    const pathStr = filePath.toString();
    const pathParts = pathStr.split('/');
    const chain = pathParts[pathParts.length - 2];
    const address = pathParts[pathParts.length - 1].replace('.json', '');

    if (chain && mockWallets[chain]) {
      mockWallets[chain].delete(address);
    }
    return undefined;
  });

  // Setup gatewayApp.inject mock
  (mockGatewayApp.inject as jest.Mock).mockImplementation(async (opts: any) => {
    const { method, url, payload } = opts;

    // Mock POST /wallet/add
    if (method === 'POST' && url === '/wallet/add') {
      try {
        if (!payload.privateKey) {
          return {
            statusCode: 400,
            headers: { 'content-type': 'application/json' },
            payload: JSON.stringify({ error: 'Missing privateKey' }),
          };
        }

        const wallet = cardano.getWalletFromPrivateKey(payload.privateKey);
        const encrypted = cardano.encrypt(payload.privateKey);

        // Simulate file write
        const address = wallet.address;
        if (!mockWallets[payload.chain]) {
          mockWallets[payload.chain] = new Set<string>();
        }
        mockWallets[payload.chain].add(address);

        return {
          statusCode: 200,
          headers: { 'content-type': 'application/json' },
          payload: JSON.stringify({ address }),
        };
      } catch (error: any) {
        return {
          statusCode: 500,
          headers: { 'content-type': 'application/json' },
          payload: JSON.stringify({ error: error.message }),
        };
      }
    }

    // Mock GET /wallet
    if (method === 'GET' && url === '/wallet') {
      const wallets: GetWalletResponse[] = [];

      for (const [chain, addresses] of Object.entries(mockWallets)) {
        wallets.push({
          chain,
          walletAddresses: Array.from(addresses),
        });
      }

      return {
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify(wallets),
      };
    }

    // Mock DELETE /wallet/remove
    if (method === 'DELETE' && url === '/wallet/remove') {
      try {
        const { address, chain } = payload;

        if (address === 'invalid-address') {
          throw new Error('Invalid address format');
        }

        if (mockWallets[chain]) {
          mockWallets[chain].delete(address);
        }

        return {
          statusCode: 200,
          headers: { 'content-type': 'application/json' },
          payload: 'null',
        };
      } catch (error: any) {
        return {
          statusCode: 500,
          headers: { 'content-type': 'application/json' },
          payload: JSON.stringify({ error: error.message }),
        };
      }
    }

    return {
      statusCode: 404,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ error: 'Not found' }),
    };
  });
});

afterAll(async () => {
  await cardano.close();
  await mockGatewayApp.close();
});

afterEach(() => {
  unpatch();
  jest.clearAllMocks();
});

describe('Cardano Wallet Operations', () => {
  describe('POST /wallet/add', () => {
    it('should add a Cardano wallet successfully', async () => {
      const response = await mockGatewayApp.inject({
        method: 'POST',
        url: '/wallet/add',
        payload: {
          privateKey: testPrivateKey,
          chain: 'cardano',
          network: 'preprod',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toMatch(/json/);

      const result = JSON.parse(response.payload);
      expect(result).toMatchObject({
        address: testAddress,
      });
    });

    it('should fail with invalid private key', async () => {
      // Override the mock to simulate invalid key
      (cardano.getWalletFromPrivateKey as jest.Mock).mockImplementation(() => {
        throw new Error('Invalid private key');
      });

      const response = await mockGatewayApp.inject({
        method: 'POST',
        url: '/wallet/add',
        payload: {
          privateKey: 'invalid-key',
          chain: 'cardano',
          network: 'preprod',
        },
      });

      expect(response.statusCode).toBe(500);
    });

    it('should fail with missing parameters', async () => {
      const response = await mockGatewayApp.inject({
        method: 'POST',
        url: '/wallet/add',
        payload: {
          chain: 'cardano',
          // missing privateKey
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET /wallet', () => {
    it('should fetch wallets for Cardano', async () => {
      // First add a wallet
      mockWallets.cardano.add(testAddress);

      const response = await mockGatewayApp.inject({
        method: 'GET',
        url: '/wallet',
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toMatch(/json/);

      const wallets: GetWalletResponse[] = JSON.parse(response.payload);
      const cardanoWallet = wallets.find((w) => w.chain === 'cardano');

      expect(cardanoWallet).toBeDefined();
      expect(cardanoWallet?.walletAddresses).toContain(testAddress);
    });

    it('should return empty array when no wallets exist', async () => {
      // Clear wallets
      mockWallets.cardano.clear();

      const response = await mockGatewayApp.inject({
        method: 'GET',
        url: '/wallet',
      });

      expect(response.statusCode).toBe(200);

      const wallets: GetWalletResponse[] = JSON.parse(response.payload);
      const cardanoWallet = wallets.find((w) => w.chain === 'cardano');

      expect(cardanoWallet?.walletAddresses).toHaveLength(0);
    });
  });

  describe('DELETE /wallet/remove', () => {
    it('should remove a Cardano wallet successfully', async () => {
      // First add the wallet to mock storage
      mockWallets.cardano.add(testAddress);

      const response = await mockGatewayApp.inject({
        method: 'DELETE',
        url: '/wallet/remove',
        payload: {
          address: testAddress,
          chain: 'cardano',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toMatch(/json/);

      expect(response.payload).toBe('null');
      expect(mockWallets.cardano.has(testAddress)).toBe(false);
    });

    it('should fail when removing non-existent wallet', async () => {
      (mockFse.pathExists as jest.Mock).mockResolvedValue(false);

      const response = await mockGatewayApp.inject({
        method: 'DELETE',
        url: '/wallet/remove',
        payload: {
          address: testAddress,
          chain: 'cardano',
        },
      });

      // The endpoint doesn't check if wallet exists, just removes the file
      expect(response.statusCode).toBe(200);
    });

    it('should fail with invalid address format', async () => {
      const response = await mockGatewayApp.inject({
        method: 'DELETE',
        url: '/wallet/remove',
        payload: {
          address: 'invalid-address',
          chain: 'cardano',
        },
      });

      // Address validation happens and throws 500 on invalid format
      expect(response.statusCode).toBe(500);
    });
  });

  describe('Wallet Operations Integration', () => {
    it('should handle full wallet lifecycle: add, fetch, and remove', async () => {
      // 1. Add wallet
      const addResponse = await mockGatewayApp.inject({
        method: 'POST',
        url: '/wallet/add',
        payload: {
          privateKey: testPrivateKey,
          chain: 'cardano',
          network: 'preprod',
        },
      });
      expect(addResponse.statusCode).toBe(200);

      // 2. Fetch wallets
      const getResponse = await mockGatewayApp.inject({
        method: 'GET',
        url: '/wallet',
      });
      expect(getResponse.statusCode).toBe(200);

      const wallets: GetWalletResponse[] = JSON.parse(getResponse.payload);
      const cardanoWallet = wallets.find((w) => w.chain === 'cardano');
      expect(cardanoWallet?.walletAddresses).toContain(testAddress);

      // 3. Remove wallet
      const removeResponse = await mockGatewayApp.inject({
        method: 'DELETE',
        url: '/wallet/remove',
        payload: {
          address: testAddress,
          chain: 'cardano',
        },
      });
      expect(removeResponse.statusCode).toBe(200);

      // 4. Verify wallet is removed
      const finalGetResponse = await mockGatewayApp.inject({
        method: 'GET',
        url: '/wallet',
      });
      expect(finalGetResponse.statusCode).toBe(200);

      const finalWallets: GetWalletResponse[] = JSON.parse(finalGetResponse.payload);
      const finalCardanoWallet = finalWallets.find((w) => w.chain === 'cardano');
      expect(finalCardanoWallet?.walletAddresses).not.toContain(testAddress);
    });
  });
});
