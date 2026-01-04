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

export const Liquidity: React.FC<Props> = ({ wallet, log, onSuccess }) => {
    const { dex, config } = useDex();
    const { showToast } = useToast();
    // Add Liquidity State
    const [amountA, setAmountA] = useState('100');
    const [amountB, setAmountB] = useState('100');
    // Remove Liquidity State
    const [removeAmount, setRemoveAmount] = useState('10');
    
    const [loading, setLoading] = useState(false);

    const broadcast = async (deploy: any, name: string) => {
        log(`Requesting signature for ${name}...`);
        const signature = await wallet.sign(deploy);
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
        log(`${name} Sent! Hash: ${txHash}`);
    };

    const handleAdd = async () => {
        if (!wallet.publicKey) return;
        setLoading(true);
        try {
            const decA = config.tokens.WCSPR.decimals;
            const decB = config.tokens.ECTO.decimals;
            const amtABI = BigInt(Math.floor(parseFloat(amountA) * (10 ** decA)));
            const amtBBI = BigInt(Math.floor(parseFloat(amountB) * (10 ** decB)));

            log(`Adding Liquidity: ${amountA} WCSPR + ${amountB} ECTO`);
            const deploy = dex.makeAddLiquidityDeploy(
                config.tokens.WCSPR.packageHash,
                config.tokens.ECTO.packageHash,
                amtABI,
                amtBBI,
                0n, // minA (no slippage protection)
                0n, // minB (no slippage protection)
                `account-hash-${wallet.publicKey.accountHash().toHex()}`,
                Date.now() + 1800000,
                wallet.publicKey
            );
            await broadcast(deploy, "Add Liquidity");
        } catch (e: any) {
             log(`Error: ${e.message}`);
        } finally {
            setLoading(false);
        }
    };

    const handleRemove = async () => {
         if (!wallet.publicKey) return;
        setLoading(true);
        try {
            // LP Token is always 18 decimals
            const liqBI = BigInt(Math.floor(parseFloat(removeAmount) * 1e18));

            log(`Removing Liquidity: ${removeAmount} LP Tokens`);
            const deploy = dex.makeRemoveLiquidityDeploy(
                config.tokens.WCSPR.packageHash,
                config.tokens.ECTO.packageHash,
                liqBI,
                0n,
                0n,
                `account-hash-${wallet.publicKey.accountHash().toHex()}`,
                Date.now() + 1800000,
                wallet.publicKey
            );
            await broadcast(deploy, "Remove Liquidity");
        } catch (e: any) {
             log(`Error: ${e.message}`);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div>
            <div className="card">
                <h2>Add Liquidity</h2>
                <div className="form-group">
                    <label>WCSPR Amount</label>
                    <input type="number" value={amountA} onChange={e => setAmountA(e.target.value)} />
                </div>
                <div className="form-group">
                    <label>ECTO Amount</label>
                    <input type="number" value={amountB} onChange={e => setAmountB(e.target.value)} />
                </div>
                <button onClick={handleAdd} disabled={loading}>{loading ? 'Processing...' : 'Add Liquidity'}</button>
            </div>

            <div className="card" style={{marginTop: '1rem'}}>
                <h2>Remove Liquidity</h2>
                <div className="form-group">
                    <label>LP Token Amount</label>
                    <input type="number" value={removeAmount} onChange={e => setRemoveAmount(e.target.value)} />
                </div>
                 <button onClick={handleRemove} disabled={loading}>{loading ? 'Processing...' : 'Remove Liquidity'}</button>
            </div>
        </div>
    );
};
