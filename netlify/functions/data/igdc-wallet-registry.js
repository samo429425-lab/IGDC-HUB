/* IGDC Unified Wallet Registry
 * Single source of truth for ALL inbound wallets (BTC, ETH, Stablecoins)
 * Drop-in file: once uploaded, admin + functions can auto-bind.
 * No runtime side-effects. Pure data + helpers.
 */

(function (global) {
  'use strict';

  const REGISTRY_VERSION = '1.0.0';

  const WALLETS = [
    // ===== Bitcoin =====
    {
      id: 'btc-main-donation',
      chain: 'BTC',
      network: 'bitcoin-mainnet',
      address: 'bc1qXXXXXXXXXXXXXXX', // TODO: replace
      accepts: ['BTC'],
      role: 'donation',
      monitor: true
    },

    // ===== Ethereum (Native + ERC20) =====
    {
      id: 'eth-main-inflow',
      chain: 'ETH',
      network: 'ethereum-mainnet',
      address: '0xXXXXXXXXXXXXXXXXXXXXXXXXXXXX', // TODO: replace
      accepts: ['ETH', 'USDC', 'USDT'],
      role: 'inflow',
      monitor: true
    }
  ];

  // ---------- Helpers ----------
  function all() {
    return WALLETS.slice();
  }

  function monitored() {
    return WALLETS.filter(w => w.monitor);
  }

  function byChain(chain) {
    return WALLETS.filter(w => w.chain === chain);
  }

  function byAddress(address) {
    return WALLETS.find(w => w.address.toLowerCase() === address.toLowerCase());
  }

  function acceptsAsset(address, asset) {
    const w = byAddress(address);
    return !!(w && w.accepts.includes(asset));
  }

  global.IGDC_WALLET_REGISTRY = {
    version: REGISTRY_VERSION,
    all,
    monitored,
    byChain,
    byAddress,
    acceptsAsset
  };

})(typeof window !== 'undefined' ? window : global);
