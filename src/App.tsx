import { useEffect, useState } from 'react';
import './App.css';
import { useWallet } from './hooks/useWallet';
import { Header } from './components/Header';
import { LogViewer } from './components/LogViewer';
import { Mint } from './components/Mint';
import { Approve } from './components/Approve';
import { Liquidity } from './components/Liquidity';
import { Swap } from './components/Swap';
import { useDex } from './contexts/DexContext';
import { ToastProvider } from './contexts/ToastContext';

function App() {
  const wallet = useWallet();
  const { dex, config } = useDex();
  const [activeTab, setActiveTab] = useState('swap');
  const [logs, setLogs] = useState<string[]>([]);
  const [balance, setBalance] = useState<string>('0');
  const [wcsprBalance, setWcsprBalance] = useState<string>('0');
  const [ectoBalance, setEctoBalance] = useState<string>('0');

  const addLog = (msg: string) => {
    const time = new Date().toLocaleTimeString();
    setLogs(prev => [`[${time}] ${msg}`, ...prev]);
  };

  const fetchBalance = async () => {
    if (wallet.activeKey && wallet.publicKey) {
        try {
            // CSPR Balance
            const bal = await dex.getCSPRBalance(wallet.activeKey);
            const bStr = bal.toString();
            setBalance(bStr.length > 9 ? bStr.slice(0, bStr.length - 9) : '0');

            // Token Balances
            const accountHash = wallet.publicKey.accountHash().toHex(); // hex string
            
            // WCSPR
            const wcspr = await dex.getTokenBalance(config.tokens.WCSPR.contractHash, `account-hash-${accountHash}`);
            setWcsprBalance((Number(wcspr) / (10 ** config.tokens.WCSPR.decimals)).toFixed(2));

            // ECTO
            const ecto = await dex.getTokenBalance(config.tokens.ECTO.contractHash, `account-hash-${accountHash}`);
            setEctoBalance((Number(ecto) / (10 ** config.tokens.ECTO.decimals)).toFixed(2));

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
               <h3>CSPR: {balance} | WCSPR: {wcsprBalance} | ECTO: {ectoBalance}</h3>
          </div>

          <div className="tabs">
              <button className={activeTab === 'swap' ? 'active' : ''} onClick={() => setActiveTab('swap')}>Swap</button>
              <button className={activeTab === 'approve' ? 'active' : ''} onClick={() => setActiveTab('approve')}>Approve</button>
              <button className={activeTab === 'liquidity' ? 'active' : ''} onClick={() => setActiveTab('liquidity')}>Liquidity</button>
              <button className={activeTab === 'mint' ? 'active' : ''} onClick={() => setActiveTab('mint')}>Mint (Test)</button>
          </div>

          <div className="content">
              {activeTab === 'swap' && <Swap wallet={wallet} log={addLog} onSuccess={fetchBalance} />}
              {activeTab === 'approve' && <Approve wallet={wallet} log={addLog} onSuccess={fetchBalance} />}
              {activeTab === 'liquidity' && <Liquidity wallet={wallet} log={addLog} onSuccess={fetchBalance} />}
              {activeTab === 'mint' && <Mint wallet={wallet} log={addLog} onSuccess={fetchBalance} />}
          </div>

          <LogViewer logs={logs} />
        </main>
      </div>
    </ToastProvider>
  );
}

export default App;
