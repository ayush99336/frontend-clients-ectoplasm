import React, { useMemo, useState } from 'react';
import sdk from 'casper-js-sdk';
import { useDex } from '../contexts/DexContext';
import { useWallet } from '../hooks/useWallet';
import { useToast } from '../contexts/ToastContext';
import { LstConfig, makeStakeDeploy, makeUnstakeDeploy, makeWithdrawDeploy } from '../services/lst';

const { Deploy } = (sdk as any).default ?? sdk;

interface Props {
  wallet: ReturnType<typeof useWallet>;
  log: (msg: string) => void;
  onSuccess?: () => void;
}

const toRawAmount = (value: string, decimals: number): bigint => {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return 0n;
  const factor = 10 ** decimals;
  return BigInt(Math.floor(num * factor));
};

export const Staking: React.FC<Props> = ({ wallet, log, onSuccess }) => {
  const { dex, config } = useDex();
  const { showToast, removeToast } = useToast();
  const [csprAmount, setCsprAmount] = useState('100');
  const [scsprAmount, setScsprAmount] = useState('100');
  const [requestId, setRequestId] = useState('');
  const [loading, setLoading] = useState(false);

  const stakingManagerHash = useMemo(
    () => LstConfig.stakingManagerPackageHash || LstConfig.stakingManagerContractHash,
    []
  );

  const ensureConfig = (): boolean => {
    if (!stakingManagerHash) {
      showToast('error', 'Missing LST contract hashes in .env');
      return false;
    }
    return true;
  };

  const sendDeploy = async (deploy: any, label: string) => {
    let pendingToastId: string | null = null;
    try {
      pendingToastId = Date.now().toString();
      showToast('pending', `Please sign the ${label} deploy in your wallet...`);

      const signature = await wallet.sign(deploy);

      if (pendingToastId) removeToast(pendingToastId);
      pendingToastId = (Date.now() + 1).toString();
      showToast('pending', `Broadcasting ${label} to network...`);

      const deployJson = Deploy.toJSON(deploy);
      const approval = {
        signer: wallet.publicKey?.toHex(),
        signature,
      };
      if (!deployJson.approvals) deployJson.approvals = [];
      deployJson.approvals.push(approval);

      const txHash = await dex.sendDeployRaw(deployJson);
      if (pendingToastId) removeToast(pendingToastId);
      showToast('success', `${label} submitted successfully!`, txHash);
      log(`${label} sent: ${txHash}`);
      if (onSuccess) setTimeout(() => onSuccess(), 2000);
    } catch (e: any) {
      if (pendingToastId) removeToast(pendingToastId);
      showToast('error', e.message?.slice(0, 100) || `${label} failed`);
      throw e;
    }
  };

  const handleStake = async () => {
    if (!wallet.activeKey || !wallet.publicKey) {
      showToast('error', 'Please connect your wallet first');
      return;
    }
    if (!ensureConfig()) return;

    const raw = toRawAmount(csprAmount, 9);
    if (raw <= 0n) {
      showToast('error', 'Enter a valid CSPR amount');
      return;
    }
    if (Number(csprAmount) < 100) {
      showToast('error', 'Minimum stake is 100 CSPR');
      return;
    }

    setLoading(true);
    try {
      log(`Staking ${csprAmount} CSPR...`);
      const deploy = makeStakeDeploy(
        stakingManagerHash,
        raw,
        wallet.publicKey,
        config.chainName
      );
      await sendDeploy(deploy, 'Stake');
    } catch (e: any) {
      log(`Stake error: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleUnstake = async () => {
    if (!wallet.activeKey || !wallet.publicKey) {
      showToast('error', 'Please connect your wallet first');
      return;
    }
    if (!ensureConfig()) return;

    const raw = toRawAmount(scsprAmount, 9);
    if (raw <= 0n) {
      showToast('error', 'Enter a valid sCSPR amount');
      return;
    }

    setLoading(true);
    try {
      log(`Unstaking ${scsprAmount} sCSPR...`);
      const deploy = makeUnstakeDeploy(
        stakingManagerHash,
        raw,
        wallet.publicKey,
        config.chainName
      );
      await sendDeploy(deploy, 'Unstake');
    } catch (e: any) {
      log(`Unstake error: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleWithdraw = async () => {
    if (!wallet.activeKey || !wallet.publicKey) {
      showToast('error', 'Please connect your wallet first');
      return;
    }
    if (!ensureConfig()) return;

    const id = BigInt(requestId || '0');
    if (id < 0n || requestId === '') {
      showToast('error', 'Enter a valid request ID');
      return;
    }

    setLoading(true);
    try {
      log(`Withdrawing request #${requestId}...`);
      const deploy = makeWithdrawDeploy(
        stakingManagerHash,
        id,
        wallet.publicKey,
        config.chainName
      );
      await sendDeploy(deploy, 'Withdraw');
    } catch (e: any) {
      log(`Withdraw error: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card">
      <h2>Liquid Staking (sCSPR)</h2>
      <div className="form-group">
        <label>Stake CSPR</label>
        <input
          type="number"
          value={csprAmount}
          onChange={(e) => {
            setCsprAmount(e.target.value);
            setScsprAmount(e.target.value);
          }}
        />
      </div>
      <button onClick={handleStake} disabled={loading}>
        {loading ? 'Staking...' : 'Stake'}
      </button>

      <hr style={{ margin: '1.5rem 0', borderColor: '#333' }} />

      <div className="form-group">
        <label>Unstake sCSPR</label>
        <input
          type="number"
          value={scsprAmount}
          onChange={(e) => setScsprAmount(e.target.value)}
        />
      </div>
      <button onClick={handleUnstake} disabled={loading}>
        {loading ? 'Unstaking...' : 'Unstake'}
      </button>

      <div style={{ fontSize: '0.85rem', color: '#aaa', marginTop: '0.75rem' }}>
        Unstaking period is ~16 hours (7 eras). After that, withdraw with your request ID.
      </div>

      <hr style={{ margin: '1.5rem 0', borderColor: '#333' }} />

      <div className="form-group">
        <label>Withdraw Request ID</label>
        <input
          type="number"
          value={requestId}
          onChange={(e) => setRequestId(e.target.value)}
        />
      </div>
      <button onClick={handleWithdraw} disabled={loading}>
        {loading ? 'Withdrawing...' : 'Withdraw'}
      </button>
    </div>
  );
};
