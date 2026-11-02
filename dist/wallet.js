const MAINNET = '0x1';
const validAccount = value => typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value);
const chainId = value => {
  try { return '0x' + BigInt(value).toString(16); } catch { return null; }
};

export function walletError(error) {
  const code = error?.code ?? error?.info?.error?.code;
  if (code === 4001 || code === 'ACTION_REJECTED') return 'Request cancelled in your wallet. Choose Connect wallet to try again.';
  if (code === -32002) return 'A wallet request is already open. Open your wallet and finish or cancel it first.';
  if (code === 4902) return 'Ethereum mainnet is unavailable in this wallet. Add Ethereum (chain ID 1) in your wallet, then reconnect.';
  if (code === 4900 || code === 4901) return 'Your wallet is disconnected from Ethereum. Open it, check its connection, then reconnect.';
  if (code === 4100) return 'Wallet access is not authorized. Connect again and approve account access in your wallet.';
  if (code === 4200) return 'This wallet does not support the requested action. Switch to Ethereum mainnet in the wallet, then reconnect.';
  return error?.shortMessage || error?.message || 'Wallet connection failed. Open your wallet and try again.';
}

export function createWalletController({ window: host, onState = () => {}, onProviders = () => {}, timeoutMs = 60000 }) {
  const choices = [];
  let active = null, listeners = [], operation = 0, started = false;
  let state = { status: 'idle', account: null, chainId: null, walletName: '', error: '', provider: null };
  const emit = update => { state = { ...state, ...update }; onState({ ...state }); };
  const bounded = promise => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Wallet request timed out. Check for an open request in your wallet before reconnecting.')), timeoutMs);
    Promise.resolve(promise).then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
  const request = (provider, method, params) => bounded(Promise.resolve().then(() => provider.request({ method, ...(params ? { params } : {}) })));
  const detach = () => {
    for (const [provider, name, handler] of listeners) provider.removeListener?.(name, handler);
    listeners = [];
  };
  function add(provider, name) {
    if (!provider || typeof provider.request !== 'function') return;
    const existing = choices.find(item => item.provider === provider);
    if (existing) {
      if (typeof name === 'string' && !name.startsWith('Browser wallet') && existing.name !== name.slice(0,80)) {
        existing.name = name.slice(0,80);
        onProviders(choices.map(({ id, name }) => ({ id, name })));
      }
      return;
    }
    choices.push({ id: 'wallet-' + choices.length, name: typeof name === 'string' ? name.slice(0, 80) : 'Browser wallet', provider });
    onProviders(choices.map(({ id, name }) => ({ id, name })));
  }
  function discover() {
    const legacy = host.ethereum;
    if (Array.isArray(legacy?.providers)) legacy.providers.forEach((provider, index) => add(provider, 'Browser wallet ' + (index + 1)));
    add(legacy, 'Browser wallet');
    host.dispatchEvent(new host.Event('eip6963:requestProvider'));
  }
  const announce = event => {
    const detail = event?.detail;
    add(detail?.provider, detail?.info?.name);
  };
  function start() {
    if (started) return;
    started = true;
    host.addEventListener('eip6963:announceProvider', announce);
    host.addEventListener('ethereum#initialized', discover);
    discover();
  }
  function disconnect(message = '') {
    operation++;
    detach();
    active = null;
    emit({ status: 'idle', account: null, chainId: null, walletName: '', error: message, provider: null });
  }
  function subscribe(choice) {
    const provider = choice.provider;
    const session = operation;
    const current = () => active === choice && operation === session && state.status !== 'connecting';
    const accountsChanged = accounts => {
      if (!current()) return;
      const account = Array.isArray(accounts) && validAccount(accounts[0]) ? accounts[0] : null;
      if (!account) { disconnect('Wallet account access ended. Connect wallet to continue.'); return; }
      emit({ account, status: state.chainId === MAINNET ? 'connected' : 'wrong-network', error: '' });
    };
    const chainChanged = value => {
      if (!current()) return;
      const chain = chainId(value);
      emit({ chainId: chain, status: chain === MAINNET && state.account ? 'connected' : 'wrong-network', error: chain === MAINNET ? '' : 'Switch to Ethereum mainnet to enable owner controls.' });
    };
    const disconnected = () => {
      if (active === choice && operation === session) disconnect('Your wallet disconnected. Reconnect when it is available.');
    };
    for (const [name, handler] of [['accountsChanged', accountsChanged], ['chainChanged', chainChanged], ['disconnect', disconnected]]) {
      provider.on?.(name, handler);
      listeners.push([provider, name, handler]);
    }
  }
  async function connect(id) {
    if (state.status === 'connecting') return;
    discover();
    const choice = choices.find(item => item.id === id) || (choices.length === 1 ? choices[0] : null);
    if (!choice) {
      emit({ status: 'error', error: choices.length ? 'Choose your Ethereum wallet first.' : 'No Ethereum wallet detected. Use a browser wallet extension or open this page in your wallet’s in-app browser.' });
      return;
    }
    detach();
    active = choice;
    const run = ++operation;
    emit({ status: 'connecting', account: null, chainId: null, walletName: choice.name, error: '', provider: null });
    subscribe(choice);
    try {
      await request(choice.provider, 'eth_requestAccounts');
      if (run !== operation) return;
      if (chainId(await request(choice.provider, 'eth_chainId')) !== MAINNET) {
        await request(choice.provider, 'wallet_switchEthereumChain', [{ chainId: MAINNET }]);
      }
      if (run !== operation) return;
      const [accounts, network] = await Promise.all([request(choice.provider, 'eth_accounts'), request(choice.provider, 'eth_chainId')]);
      if (run !== operation) return;
      if (!Array.isArray(accounts) || !validAccount(accounts[0])) throw Error('No wallet account selected. Unlock your wallet and reconnect.');
      const chain = chainId(network);
      if (chain !== MAINNET) throw Error('Your wallet is still on another network. Select Ethereum mainnet and reconnect.');
      emit({ status: 'connected', account: accounts[0], chainId: chain, walletName: choice.name, error: '', provider: choice.provider });
    } catch (error) {
      if (run !== operation) return;
      detach();
      active = null;
      emit({ status: 'error', account: null, chainId: null, provider: null, error: walletError(error) });
    }
  }
  return {
    start, discover, connect, disconnect,
    getState: () => ({ ...state }),
    getProviders: () => choices.map(({ id, name }) => ({ id, name })),
    destroy() { disconnect(); host.removeEventListener('eip6963:announceProvider', announce); host.removeEventListener('ethereum#initialized', discover); started = false; },
  };
}
