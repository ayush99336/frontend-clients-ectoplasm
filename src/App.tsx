import { useEffect, useState } from 'react';
import './App.css';
import { useWallet } from './hooks/useWallet';
import { Header } from './components/Header';
import { LogViewer } from './components/LogViewer';
import { Mint } from './components/Mint';
import { Approve } from './components/Approve';
import { Liquidity } from './components/Liquidity';
import { Swap } from './components/Swap';
import { PairsList } from './components/PairsList';
import { useDex } from './contexts/DexContext';
import { ToastProvider } from './contexts/ToastContext';

function App() {
  const wallet = useWallet();
  const { dex, config } = useDex();
  const [activeTab, setActiveTab] = useState('swap');
  const [logs, setLogs] = useState<string[]>([]);
  const [balance, setBalance] = useState<string>('0');
  const [tokenBalances, setTokenBalances] = useState<Record<string, string>>({});

  const formatTokenBalance = (value: bigint, decimals: number, precision = 4) => {
    const raw = value.toString();
    if (decimals <= 0) return raw;
    const padded = raw.padStart(decimals + 1, '0');
    const whole = padded.slice(0, -decimals);
    let fraction = padded.slice(-decimals).replace(/0+$/, '');
    if (precision >= 0 && fraction.length > precision) fraction = fraction.slice(0, precision);
    return fraction.length ? `${whole}.${fraction}` : whole;
  };

  const addLog = (msg: string) => {
    const time = new Date().toLocaleTimeString();
    setLogs(prev => [`[${time}] ${msg}`, ...prev]);
  };

  const fetchBalance = async () => {
    if (wallet.activeKey && wallet.publicKey) {
        try {
            // CSPR Balance
            const bal = await dex.getCSPRBalance(wallet.activeKey);
            setBalance(formatTokenBalance(bal, 9, 4));

            // Token Balances
            const accountHash = wallet.publicKey.accountHash().toHex(); // hex string
            const entries = Object.entries(config.tokens).filter(([, t]) => t.contractHash);
            const balances = await Promise.all(entries.map(async ([symbol, token]) => {
              const bal = await dex.getTokenBalance(token.contractHash, `account-hash-${accountHash}`);
              return [symbol, formatTokenBalance(bal, token.decimals, 4)] as const;
            }));
            setTokenBalances(Object.fromEntries(balances));

        } catch(e) { console.error(e); }
    }
  };
  
  // Poll balances (and fetch immediately on connect)
  useEffect(() => {
    if (!wallet.isConnected || !wallet.activeKey || !wallet.publicKey) return;
    fetchBalance();
    const i = setInterval(fetchBalance, 10000);
    return () => clearInterval(i);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet.isConnected, wallet.activeKey, wallet.publicKey]);

  return (
    <ToastProvider>
      <div className="app-container">
        <Header wallet={wallet} />
        
        <main style={{ padding: '2rem' }}>
          <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
               <h3>
                {`CSPR: ${balance} | `}
                {Object.keys(config.tokens)
                  .map(symbol => `${symbol}: ${tokenBalances[symbol] ?? '0'}`)
                  .join(' | ')}
               </h3>
          </div>

          <div className="tabs">
              <button className={activeTab === 'swap' ? 'active' : ''} onClick={() => setActiveTab('swap')}>Swap</button>
              <button className={activeTab === 'approve' ? 'active' : ''} onClick={() => setActiveTab('approve')}>Approve</button>
              <button className={activeTab === 'liquidity' ? 'active' : ''} onClick={() => setActiveTab('liquidity')}>Liquidity</button>
              <button className={activeTab === 'pools' ? 'active' : ''} onClick={() => setActiveTab('pools')}>Pools</button>
              <button className={activeTab === 'mint' ? 'active' : ''} onClick={() => setActiveTab('mint')}>Mint (Test)</button>
          </div>

          <div className="content">
              {activeTab === 'swap' && <Swap wallet={wallet} log={addLog} onSuccess={fetchBalance} />}
              {activeTab === 'approve' && <Approve wallet={wallet} log={addLog} onSuccess={fetchBalance} />}
              {activeTab === 'liquidity' && <Liquidity wallet={wallet} log={addLog} onSuccess={fetchBalance} />}
              {activeTab === 'pools' && <PairsList />}
              {activeTab === 'mint' && <Mint wallet={wallet} log={addLog} onSuccess={fetchBalance} />}
          </div>

          <LogViewer logs={logs} />
        </main>
      </div>
    </ToastProvider>
  );
}

export default App;
