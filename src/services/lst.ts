import * as sdk from 'casper-js-sdk';

const {
  Args,
  CLValue,
  DeployHeader,
  ExecutableDeployItem,
  Deploy,
  StoredVersionedContractByHash,
  ContractPackageHash,
} = (sdk as any).default ?? sdk;

const ENV = import.meta.env as any;
const envGet = (key: string): string => {
  const v = ENV?.[key] ?? ENV?.[`VITE_${key}`];
  return typeof v === 'string' ? v : '';
};

export const LstConfig = {
  scsprPackageHash: envGet('SCSPR_PACKAGE_HASH'),
  scsprContractHash: envGet('SCSPR_CONTRACT_HASH'),
  stakingManagerPackageHash: envGet('STAKING_MANAGER_PACKAGE_HASH'),
  stakingManagerContractHash: envGet('STAKING_MANAGER_CONTRACT_HASH'),
};

const normalizePackageHash = (hash: string): string =>
  hash.replace(/^(hash-|contract-package-)/, '');

const buildDeploy = (
  packageHash: string,
  entryPoint: string,
  args: any,
  paymentAmount: string,
  senderPublicKey: any,
  chainName: string
): any => {
  const header = DeployHeader.default();
  header.account = senderPublicKey;
  header.chainName = chainName;
  header.gasPrice = 1;

  const session = new ExecutableDeployItem();
  const cleanHash = normalizePackageHash(packageHash);
  session.storedVersionedContractByHash = new StoredVersionedContractByHash(
    ContractPackageHash.newContractPackage(cleanHash),
    entryPoint,
    args,
    null
  );

  const payment = ExecutableDeployItem.standardPayment(paymentAmount);
  return Deploy.makeDeploy(header, payment, session);
};

export const makeStakeDeploy = (
  stakingManagerPackageHash: string,
  amount: bigint,
  senderPublicKey: any,
  chainName: string
): any => {
  const args = Args.fromMap({
    cspr_amount: CLValue.newCLUInt256(amount.toString()),
  });

  return buildDeploy(
    stakingManagerPackageHash,
    'stake',
    args,
    '5000000000', // 5 CSPR
    senderPublicKey,
    chainName
  );
};

export const makeUnstakeDeploy = (
  stakingManagerPackageHash: string,
  amount: bigint,
  senderPublicKey: any,
  chainName: string
): any => {
  const args = Args.fromMap({
    scspr_amount: CLValue.newCLUInt256(amount.toString()),
  });

  return buildDeploy(
    stakingManagerPackageHash,
    'unstake',
    args,
    '3000000000', // 3 CSPR
    senderPublicKey,
    chainName
  );
};

export const makeWithdrawDeploy = (
  stakingManagerPackageHash: string,
  requestId: bigint,
  senderPublicKey: any,
  chainName: string
): any => {
  const args = Args.fromMap({
    request_id: CLValue.newCLUint64(requestId),
  });

  return buildDeploy(
    stakingManagerPackageHash,
    'withdraw_unstaked',
    args,
    '2000000000', // 2 CSPR
    senderPublicKey,
    chainName
  );
};
