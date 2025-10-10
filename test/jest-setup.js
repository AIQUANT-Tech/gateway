// This file contains global setup for Jest tests
// It handles test timeouts and module mocking

// Minimal mock for @aiquant/lucid-cardano because this package uses top level await
jest.mock('@aiquant/lucid-cardano', () => {
  // lightweight Lucid instance stub
  class LucidStub {
    static async new(_provider, _network) {
      // return an object with the most commonly used methods
      return {
        wallet: {
          address: async () => 'addr_test_fakeaddress',
        },
        selectWalletFromPrivateKey: (_pk) => {},
        utxosAt: async (_addr) => [],
        // add other methods your code may call
      };
    }
  }

  function BlockfrostStub(apiUrl, projectId) {
    this.apiUrl = apiUrl;
    this.projectId = projectId;
  }

  class UTxOStub {}
  const NetworkStub = { Mainnet: 'Mainnet', Preprod: 'Preprod', Preview: 'Preview' };

  // Export common named exports used by your app
  return {
    Lucid: LucidStub,
    Blockfrost: BlockfrostStub,
    UTxO: UTxOStub,
    Network: NetworkStub,
    // also export other values to satisfy direct imports
    Assets: {},
    TxComplete: {},
  };
});

// Minimal mock for @aiquant/sundaeswap-core and its lucid subpath
jest.mock('@aiquant/sundaeswap-core', () => {
  // Export a tiny enum-like object for EDatumType
  const EDatumType = { DEFAULT: 'DEFAULT' };

  // Placeholder classes used at runtime by your code
  class DatumBuilderLucidV3 {
    constructor(opts) {
      // optionally capture opts to make tests deterministic
      this.opts = opts;
    }
    // add methods the real class exposes if your code calls them
    build() {
      return {};
    }
  }

  class TxBuilderLucidV3 {
    constructor() {}
    build() {
      return {};
    }
  }

  // If the package exports other runtime utilities, stub them here
  return {
    EDatumType,
    IDepositConfigArgs: {}, // types are compile-time only but leave placeholder
    TSupportedNetworks: {},
    DatumBuilderLucidV3,
    TxBuilderLucidV3,
    // any other named exports you see imported elsewhere can be added
  };
});

// Also mock deep import path if your code imports subpath directly
jest.mock('@aiquant/sundaeswap-core/lucid', () => {
  return {
    DatumBuilderLucidV3: class {
      constructor() {}
      build() {
        return {};
      }
    },
    TxBuilderLucidV3: class {
      constructor() {}
      build() {
        return {};
      }
    },
  };
});

// Minimal mock for @sundaeswap/asset package
jest.mock('@sundaeswap/asset', () => {
  return {
    AssetAmount: class {
      constructor() {}
      toString() {
        return '0';
      }
    },
    IAssetAmountMetadata: {},
  };
});

// Set global Jest timeout to 10 seconds
jest.setTimeout(10000);

// Mock the brotli module to prevent ASM.js errors
jest.mock('brotli', () => ({
  compress: jest.fn().mockImplementation(() => Buffer.from([])),
  decompress: jest.fn().mockImplementation(() => Buffer.from([])),
  isCompressed: jest.fn().mockReturnValue(false),
}));
