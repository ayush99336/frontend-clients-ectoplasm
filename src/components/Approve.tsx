import React, { useState } from 'react';
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

export const Approve: React.FC<Props> = ({ wallet, log, onSuccess }) => {
    const { dex, config } = useDex();
    const { showToast, removeToast } = useToast();
    const tokenSymbols = Object.keys(config.tokens);
    const [token, setToken] = useState<string>(tokenSymbols[0] || 'WCSPR');
    const [amount, setAmount] = useState('1000');
    const [loading, setLoading] = useState(false);

    const handleApprove = async () => {
        if (!wallet.activeKey || !wallet.publicKey) {
            showToast('error', 'Please connect your wallet first');
            return;
        }
        
        let pendingToastId: string | null = null;
        setLoading(true);
        try {
            const decimals = config.tokens[token].decimals;
            const amountBI = BigInt(parseFloat(amount) * (10 ** decimals));
            const tokenHash = config.tokens[token].packageHash;
            const spender = config.routerPackageHash;

            log(`Approving ${amount} ${token} for Router...`);
            
            pendingToastId = Date.now().toString();
            showToast('pending', 'Please sign the approval in your wallet...');
            
            const deploy = dex.makeApproveTokenDeploy(
                tokenHash,
                spender,
                amountBI,
                wallet.publicKey
            );

            log('Requesting signature...');
            const signature = await wallet.sign(deploy);
            
            if (pendingToastId) removeToast(pendingToastId);
            pendingToastId = (Date.now() + 1).toString();
            showToast('pending', 'Broadcasting approval to network...');
            log(`Signed! Signature: ${signature.slice(0, 20)}...`);

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
            
            if (pendingToastId) removeToast(pendingToastId);
            showToast('success', 'Approval submitted successfully!', txHash);
            log(`Approve Sent! Hash: ${txHash}`);
            
            if (onSuccess) setTimeout(() => onSuccess(), 2000);
        } catch (e: any) {
            if (pendingToastId) removeToast(pendingToastId);
            
            let errorMessage = e.message?.includes('User rejected') 
                ? 'Approval rejected by user' 
                : e.message?.slice(0, 100) || 'Approval failed';
            
            showToast('error', errorMessage);
            log(`Error: ${e.message}`);
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="card">
            <h2>Approve Router</h2>
            <div className="form-group">
                <label>Token</label>
                <select value={token} onChange={(e) => setToken(e.target.value as any)}>
                    {tokenSymbols.map((symbol) => (
                        <option key={symbol} value={symbol}>{symbol}</option>
                    ))}
                </select>
            </div>
            <div className="form-group">
                <label>Amount</label>
                <input 
                    type="number" 
                    value={amount} 
                    onChange={(e) => setAmount(e.target.value)} 
                />
            </div>
            <button onClick={handleApprove} disabled={loading}>
                {loading ? 'Approving...' : 'Approve'}
            </button>
        </div>
    );
};
