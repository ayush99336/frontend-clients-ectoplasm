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

export const Mint: React.FC<Props> = ({ wallet, log, onSuccess }) => {
    const { dex, config } = useDex();
    const { showToast } = useToast();
    const [token, setToken] = useState<string>('WCSPR');
    const [amount, setAmount] = useState('1000');
    const [loading, setLoading] = useState(false);

    const handleMint = async () => {
        if (!wallet.activeKey || !wallet.publicKey) {
            alert('Connect Wallet first');
            return;
        }
        setLoading(true);
        try {
            const decimals = config.tokens[token].decimals;
            const amountBI = BigInt(parseFloat(amount) * (10 ** decimals));
            const packageHash = config.tokens[token].packageHash;

            log(`Preparing mint of ${amount} ${token}...`);
            const deploy = dex.makeMintTokenDeploy(
                packageHash,
                `account-hash-${wallet.publicKey.accountHash().toHex()}`,
                amountBI,
                wallet.publicKey
            );

            log('Requesting signature...');
            const signature = await wallet.sign(deploy);
            log(`Signed! Signature: ${signature.slice(0, 20)}...`);

            // Attach signature
            // const signedDeploy = deploy;
            // Use JSON payload to avoid object serialization issues in SDK
            const deployJson = Deploy.toJSON(deploy);
            
            // Approval structure in JSON is plain object
            const approval = { 
                signer: wallet.publicKey.toHex(),
                signature: signature 
            };
            
            if (!deployJson.approvals) deployJson.approvals = [];
            deployJson.approvals.push(approval);

            log('Broadcasting JSON...');
            const txHash = await dex.sendDeployRaw(deployJson);
            log(`Mint Sent! Hash: ${txHash}`);
        } catch (e: any) {
            log(`Error: ${e.message}`);
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="card">
            <h2>Mint Test Tokens</h2>
            <div className="form-group">
                <label>Token</label>
                <select value={token} onChange={(e) => setToken(e.target.value as any)}>
                    {Object.keys(config.tokens).map((symbol) => (
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
            <button onClick={handleMint} disabled={loading}>
                {loading ? 'Minting...' : 'Mint'}
            </button>
        </div>
    );
};
