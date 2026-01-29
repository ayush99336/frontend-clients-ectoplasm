import React, { useState, useEffect } from 'react';
import sdk from 'casper-js-sdk';
import { useDex } from '../contexts/DexContext';
import { useWallet } from '../hooks/useWallet';
import { useToast } from '../contexts/ToastContext';

const { Deploy } = (sdk as any).default ?? sdk;

interface Props {
    wallet: ReturnType<typeof useWallet>;
    log: (msg: string) => void;
    onSuccess?: () => void;
}

export const Swap: React.FC<Props> = ({ wallet, log, onSuccess }) => {
    const { dex, config } = useDex();
    const { showToast, removeToast } = useToast();
    const tokenSymbols = Object.keys(config.tokens);
    
    // Token selection
    const [tokenIn, setTokenIn] = useState<string>(tokenSymbols[0] || 'WCSPR');
    const [tokenOut, setTokenOut] = useState<string>(tokenSymbols[1] || tokenSymbols[0] || 'ECTO');
    
    const [amountIn, setAmountIn] = useState('10');
    const [loading, setLoading] = useState(false);
    const [pairInfo, setPairInfo] = useState<{r0: bigint, r1: bigint, token0: string, token1: string} | null>(null);
    const [pairDebug, setPairDebug] = useState<{ index: number; storageKey: string; hit: boolean }[]>([]);
    const [pairAddr, setPairAddr] = useState<string | null>(null);
    const [pairError, setPairError] = useState<string | null>(null);
    const [pairNamedKeys, setPairNamedKeys] = useState<string[]>([]);
    const [slippage, setSlippage] = useState('0.5'); // 0.5% default slippage
    
    // Swap preview state
    const [expectedOutput, setExpectedOutput] = useState<string>('0');
    const [priceImpact, setPriceImpact] = useState<number>(0);
    const [minimumReceived, setMinimumReceived] = useState<string>('0');

    // Swap token direction
    const handleSwapDirection = () => {
        setTokenIn(tokenOut);
        setTokenOut(tokenIn);
    };

    // Prevent same token selection
    useEffect(() => {
        if (tokenIn === tokenOut) {
            const fallback = tokenSymbols.find((s) => s !== tokenIn);
            if (fallback) setTokenOut(fallback);
        }
    }, [tokenIn, tokenOut, tokenSymbols]);

    const normalizeHash = (keyStr: string) => {
        if (!keyStr) return '';
        return keyStr
            .toLowerCase()
            .replace(/^hash-/, '')
            .replace(/^contract-/, '')
            .replace(/^contract-package-/, '');
    };

    const serializeKey = (keyStr: string): Uint8Array => {
        let tag = 1;
        let clean = keyStr;
        if (keyStr.startsWith('account-hash-')) {
            tag = 0;
            clean = keyStr.replace('account-hash-', '');
        } else if (keyStr.startsWith('hash-')) {
            clean = keyStr.replace('hash-', '');
        } else if (keyStr.startsWith('contract-package-')) {
            clean = keyStr.replace('contract-package-', '');
        }
        const bytes = new Uint8Array(33);
        bytes[0] = tag;
        const hashBytes = new Uint8Array(clean.match(/.{1,2}/g)!.map(b => parseInt(b, 16)));
        bytes.set(hashBytes, 1);
        return bytes;
    };

    const compareBytes = (a: Uint8Array, b: Uint8Array): number => {
        const len = Math.min(a.length, b.length);
        for (let i = 0; i < len; i++) {
            if (a[i] !== b[i]) return a[i] - b[i];
        }
        return a.length - b.length;
    };

    useEffect(() => {
        const fetchReserves = async () => {
            setPairError(null);
            setPairNamedKeys([]);
            const tokenInCfg = config.tokens[tokenIn];
            const tokenOutCfg = config.tokens[tokenOut];
            if (!tokenInCfg?.packageHash || !tokenOutCfg?.packageHash || tokenIn === tokenOut) {
                setPairAddr(null);
                setPairInfo(null);
                return;
            }

            try {
                const pairResult = await dex.getPairAddressDebug(
                    tokenInCfg.packageHash,
                    tokenOutCfg.packageHash
                );

                setPairDebug(pairResult.tried.map(t => ({ index: t.index, storageKey: t.storageKey, hit: t.hit })));
                setPairAddr(pairResult.pairAddr);

                if (!pairResult.pairAddr) {
                    setPairInfo(null);
                    return;
                }

                const res = await dex.getPairReserves(pairResult.pairAddr);
                const pairTokens = await dex.getPairTokens(pairResult.pairAddr);
                if (!pairTokens) {
                    const dbg = await dex.getPairStateDebug(pairResult.pairAddr);
                    setPairNamedKeys(dbg?.namedKeys ?? []);
                }

                let token0 = tokenIn;
                let token1 = tokenOut;

                if (pairTokens) {
                    const findSymbol = (addr: string) => {
                        const normalized = normalizeHash(addr);
                        return Object.entries(config.tokens).find(([, t]) => {
                            const pkg = normalizeHash(t.packageHash);
                            const ctr = normalizeHash(t.contractHash);
                            return normalized === pkg || normalized === ctr;
                        })?.[0];
                    };

                    const token0Symbol = findSymbol(pairTokens.token0);
                    const token1Symbol = findSymbol(pairTokens.token1);
                    if (token0Symbol && token1Symbol) {
                        token0 = token0Symbol;
                        token1 = token1Symbol;
                    } else if (token0Symbol && !token1Symbol) {
                        token0 = token0Symbol;
                        token1 = token0 === tokenIn ? tokenOut : tokenIn;
                    } else if (!token0Symbol && token1Symbol) {
                        token1 = token1Symbol;
                        token0 = token1 === tokenIn ? tokenOut : tokenIn;
                    }
                } else {
                    const keyA = serializeKey(tokenInCfg.packageHash);
                    const keyB = serializeKey(tokenOutCfg.packageHash);
                    token0 = compareBytes(keyA, keyB) <= 0 ? tokenIn : tokenOut;
                    token1 = token0 === tokenIn ? tokenOut : tokenIn;
                }

                setPairInfo({ r0: res.reserve0, r1: res.reserve1, token0, token1 });
            } catch (e: any) {
                setPairInfo(null);
                setPairAddr(null);
                setPairError(e?.message || 'Failed to load pool');
            }
        };
        fetchReserves();
    }, [dex, config, tokenIn, tokenOut]);

    // Calculate swap preview whenever input, reserves, or token selection changes
    useEffect(() => {
        if (!pairInfo || !amountIn || parseFloat(amountIn) <= 0) {
            setExpectedOutput('0');
            setPriceImpact(0);
            setMinimumReceived('0');
            return;
        }

        try {
            const decIn = config.tokens[tokenIn].decimals;
            const decOut = config.tokens[tokenOut].decimals;
            const amountInBigInt = BigInt(Math.floor(parseFloat(amountIn) * (10 ** decIn)));
            
            // Determine correct reserve order based on token direction
            const reserveIn = tokenIn === pairInfo.token0 ? pairInfo.r0 : pairInfo.r1;
            const reserveOut = tokenIn === pairInfo.token0 ? pairInfo.r1 : pairInfo.r0;
            
            // Calculate expected output using AMM formula
            const outputAmount = dex.getAmountOut(amountInBigInt, reserveIn, reserveOut);
            const outputFormatted = (Number(outputAmount) / (10 ** decOut)).toFixed(4);
            setExpectedOutput(outputFormatted);

            // Calculate price impact
            const currentPrice = Number(reserveOut) / Number(reserveIn);
            const expectedPrice = Number(outputAmount) / Number(amountInBigInt);
            const impact = ((currentPrice - expectedPrice) / currentPrice) * 100;
            setPriceImpact(impact);

            // Calculate minimum received with slippage
            const slippageMultiplier = 1 - (parseFloat(slippage) / 100);
            const minReceived = (parseFloat(outputFormatted) * slippageMultiplier).toFixed(4);
            setMinimumReceived(minReceived);
        } catch (e) {
            console.error('Error calculating swap preview:', e);
        }
    }, [amountIn, pairInfo, slippage, tokenIn, tokenOut, dex, config]);

    const handleSwap = async () => {
        if (!wallet.publicKey) {
            showToast('error', 'Please connect your wallet first');
            return;
        }

        if (parseFloat(amountIn) <= 0) {
            showToast('error', 'Please enter a valid amount');
            return;
        }

        let pendingToastId: string | null = null;
        setLoading(true);
        
        try {
            const decIn = config.tokens[tokenIn].decimals;
            const decOut = config.tokens[tokenOut].decimals;
            const amtInBI = BigInt(Math.floor(parseFloat(amountIn) * (10 ** decIn)));
            const amtOutMinBI = BigInt(Math.floor(parseFloat(minimumReceived) * (10 ** decOut)));

            log(`Swapping ${amountIn} ${tokenIn} -> ${expectedOutput} ${tokenOut} (min: ${minimumReceived})...`);
            
            const deploy = dex.makeSwapExactTokensForTokensDeploy(
                amtInBI,
                amtOutMinBI,
                [config.tokens[tokenIn].packageHash, config.tokens[tokenOut].packageHash],
                `account-hash-${wallet.publicKey.accountHash().toHex()}`,
                Date.now() + 1800000,
                wallet.publicKey
            );

            // Show pending toast for signing
            pendingToastId = Date.now().toString();
            showToast('pending', 'Please sign the transaction in your wallet...');
            log('Requesting signature...');
            
            const signature = await wallet.sign(deploy);
            log(`Signed! Signature: ${signature.slice(0, 20)}...`);

            // Update toast for broadcasting
            if (pendingToastId) removeToast(pendingToastId);
            pendingToastId = (Date.now() + 1).toString();
            showToast('pending', 'Broadcasting transaction to network...');

            // Use JSON payload
            const deployJson = Deploy.toJSON(deploy);
            const approval = { 
                signer: wallet.publicKey.toHex(), 
                signature 
            };
            if (!deployJson.approvals) deployJson.approvals = [];
            deployJson.approvals.push(approval);

            log('Broadcasting JSON...');
            const txHash = await dex.sendDeployRaw(deployJson);
            
            // Remove pending toast and show success
            if (pendingToastId) removeToast(pendingToastId);
            showToast('success', `Swap submitted successfully!`, txHash);
            log(`Swap Sent! Hash: ${txHash}`);

            // Refresh balances after successful swap
            if (onSuccess) {
                setTimeout(() => onSuccess(), 2000); // Wait 2s for network propagation
            }
        } catch (e: any) {
            // Remove pending toast
            if (pendingToastId) removeToast(pendingToastId);
            
            // Show user-friendly error
            let errorMessage = 'Transaction failed';
            if (e.message?.includes('User rejected')) {
                errorMessage = 'Transaction rejected by user';
            } else if (e.message?.includes('insufficient')) {
                errorMessage = 'Insufficient balance or allowance';
            } else if (e.message?.includes('slippage')) {
                errorMessage = 'Slippage tolerance exceeded';
            } else if (e.message) {
                errorMessage = e.message.slice(0, 100); // Truncate long errors
            }
            
            showToast('error', errorMessage);
            log(`Error: ${e.message}`);
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const getPriceImpactColor = () => {
        if (priceImpact < 1) return '#4ade80'; // green
        if (priceImpact < 5) return '#fbbf24'; // yellow
        if (priceImpact < 10) return '#fb923c'; // orange
        return '#ef4444'; // red
    };

    return (
        <div className="card">
            <h2>Swap Tokens</h2>
             {pairInfo && (
                <div style={{fontSize: '0.8rem', marginBottom: '1rem', color: '#aaa'}}>
                    Pool: {(Number(pairInfo.r0) / 10**config.tokens[pairInfo.token0].decimals).toFixed(2)} {pairInfo.token0} / {(Number(pairInfo.r1) / 10**config.tokens[pairInfo.token1].decimals).toFixed(2)} {pairInfo.token1}
                </div>
            )}
            {!pairInfo && tokenIn !== tokenOut && (
                <div style={{fontSize: '0.8rem', marginBottom: '1rem', color: '#aaa'}}>
                    No pool found for {tokenIn} / {tokenOut}
                    {pairDebug.length > 0 && (
                        <div style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: '#888' }}>
                            Tried factory indices: {pairDebug.map(t => `${t.index}${t.hit ? '✓' : '✗'}`).join(', ')}
                        </div>
                    )}
                    {pairAddr && (
                        <div style={{ marginTop: '0.35rem', fontSize: '0.75rem', color: '#888' }}>
                            Pair address: {pairAddr}
                        </div>
                    )}
                    {pairError && (
                        <div style={{ marginTop: '0.35rem', fontSize: '0.75rem', color: '#c66' }}>
                            Error: {pairError}
                        </div>
                    )}
                    {!pairInfo && pairAddr && pairNamedKeys.length > 0 && (
                        <div style={{ marginTop: '0.35rem', fontSize: '0.75rem', color: '#888' }}>
                            Pair named_keys: {pairNamedKeys.join(', ')}
                        </div>
                    )}
                </div>
            )}
            
            {/* Input Token */}
            <div className="form-group">
                <label>From</label>
                <div style={{display: 'flex', gap: '8px'}}>
                    <select 
                        value={tokenIn} 
                        onChange={e => setTokenIn(e.target.value)}
                        style={{flex: '0 0 100px'}}
                    >
                        {tokenSymbols.map((symbol) => (
                            <option key={symbol} value={symbol}>{symbol}</option>
                        ))}
                    </select>
                    <input 
                        type="number" 
                        value={amountIn} 
                        onChange={e => setAmountIn(e.target.value)} 
                        placeholder="0.0"
                        style={{flex: 1}}
                    />
                </div>
            </div>

            {/* Swap Direction Button */}
            <div style={{textAlign: 'center', margin: '0.5rem 0'}}>
                <button 
                    onClick={handleSwapDirection}
                    style={{
                        background: 'none',
                        border: '2px solid #555',
                        borderRadius: '50%',
                        width: '40px',
                        height: '40px',
                        cursor: 'pointer',
                        fontSize: '20px'
                    }}
                    type="button"
                >
                    ⇅
                </button>
            </div>

            {/* Output Token */}
            <div className="form-group">
                <label>To</label>
                <div style={{display: 'flex', gap: '8px'}}>
                    <select 
                        value={tokenOut} 
                        onChange={e => setTokenOut(e.target.value)}
                        style={{flex: '0 0 100px'}}
                    >
                        {tokenSymbols.map((symbol) => (
                            <option key={symbol} value={symbol}>{symbol}</option>
                        ))}
                    </select>
                    <input 
                        type="text" 
                        value={expectedOutput} 
                        readOnly
                        placeholder="0.0"
                        style={{flex: 1, background: 'rgba(255,255,255,0.05)'}}
                    />
                </div>
            </div>

            {/* Swap Preview */}
            {parseFloat(amountIn) > 0 && pairInfo && (
                <div style={{
                    background: 'rgba(255,255,255,0.05)',
                    padding: '1rem',
                    borderRadius: '8px',
                    marginBottom: '1rem',
                    fontSize: '0.9rem'
                }}>
                    <div style={{display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem'}}>
                        <span style={{color: '#aaa'}}>Expected Output:</span>
                        <span style={{fontWeight: 'bold'}}>{expectedOutput} {tokenOut}</span>
                    </div>
                    <div style={{display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem'}}>
                        <span style={{color: '#aaa'}}>Price Impact:</span>
                        <span style={{color: getPriceImpactColor(), fontWeight: 'bold'}}>
                            {priceImpact.toFixed(2)}%
                        </span>
                    </div>
                    <div style={{display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem'}}>
                        <span style={{color: '#aaa'}}>Minimum Received:</span>
                        <span>{minimumReceived} {tokenOut}</span>
                    </div>
                    <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                        <span style={{color: '#aaa'}}>Slippage Tolerance:</span>
                        <input 
                            type="number" 
                            value={slippage} 
                            onChange={e => setSlippage(e.target.value)}
                            style={{width: '60px', textAlign: 'right'}}
                            step="0.1"
                        />
                        <span style={{marginLeft: '4px'}}>%</span>
                    </div>
                    
                    {priceImpact >= 5 && (
                        <div style={{
                            marginTop: '0.75rem',
                            padding: '0.5rem',
                            background: priceImpact >= 10 ? 'rgba(239, 68, 68, 0.1)' : 'rgba(251, 146, 60, 0.1)',
                            border: `1px solid ${priceImpact >= 10 ? '#ef4444' : '#fb923c'}`,
                            borderRadius: '4px',
                            fontSize: '0.85rem',
                            color: priceImpact >= 10 ? '#ef4444' : '#fb923c'
                        }}>
                            ⚠️ {priceImpact >= 10 ? 'High' : 'Moderate'} price impact! Consider reducing your swap amount.
                        </div>
                    )}
                </div>
            )}

            <button onClick={handleSwap} disabled={loading || !pairInfo || parseFloat(amountIn) <= 0}>
                {loading ? 'Swapping...' : 'Swap'}
            </button>
        </div>
    );
};
