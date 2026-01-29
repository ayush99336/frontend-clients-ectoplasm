/**
 * Ectoplasm DEX Client for Casper JS SDK v5
 * 
 * This client provides typed functions for interacting with the DEX contracts:
 * - Router: swap, addLiquidity, removeLiquidity
 * - Pair: getReserves
 * - Token: approve, balanceOf
 */

import * as sdk from 'casper-js-sdk';
import { blake2bHex } from 'blakejs';

const {
    RpcClient,
    HttpHandler,
    DeployUtil,
    Keys,
    CLValue,
    RuntimeArgs,
    CLAccountHash,
    CLKey,
    CLByteArray,
    CLURef,
    DeployHeader,
    ExecutableDeployItem,
    Deploy,
    Contracts,
    StoredVersionedContractByHash,
    ContractPackageHash,
    Args,
    CLTypeKey,
    Key,
    PublicKey,
    AccountHash,
    PurseIdentifier
} = (sdk as any).default ?? sdk; // Fallback to sdk if default missing

console.log('SDK Exports:', Object.keys(sdk));
console.log('PurseIdentifier:', PurseIdentifier);

// ============ Configuration ============

export interface DexConfig {
    nodeUrl: string;
    chainName: string;
    routerPackageHash: string;
    routerContractHash: string;
    factoryHash: string;
    tokens: {
        [symbol: string]: {
            packageHash: string;
            contractHash: string;
            decimals: number;
        };
    };
    pairs: {
        [name: string]: string; // e.g., "WCSPR-ECTO": "hash-..."
    };
}

// ============ DEX Client ============

export class DexClient {
    private rpcClient: any;
    private config: DexConfig;
    private pairAddressCache = new Map<string, string>();

    private normalizeContractKey(key: string): string {
        const k = (key || '').trim().replace(/^0x/i, '');
        if (k.startsWith('hash-') || k.startsWith('entity-contract-') || k.startsWith('contract-')) return k;
        return `hash-${k}`;
    }

    private pairCacheKey(tokenA: string, tokenB: string): string {
        const a = (tokenA || '').toLowerCase();
        const b = (tokenB || '').toLowerCase();
        return a < b ? `${a}|${b}` : `${b}|${a}`;
    }

    private normalizeStateRootHash(value: any): string {
        if (!value) return value;
        if (typeof value === 'string') return value;
        if (typeof value === 'object') {
            // SDK variants: Digest / stateRootHash object
            if (typeof (value as any).toHex === 'function') return (value as any).toHex();
            if (typeof (value as any).toString === 'function') return (value as any).toString();
        }
        return String(value);
    }

    constructor(config: DexConfig) {
        this.config = config;
        // In dev, always use the Vite proxy to avoid node CORS.
        // In prod, prefer HTTPS direct if provided, otherwise use the Vercel proxy.
        const isDev = (import.meta as any).env?.DEV;
        const isBrowser = typeof window !== 'undefined';
        const isHttps = isBrowser && window.location.protocol === 'https:';
        const isHttpNode = config.nodeUrl?.startsWith('http://');
        const directUrl = config.nodeUrl?.startsWith('https://')
            ? (config.nodeUrl.endsWith('/rpc') ? config.nodeUrl : `${config.nodeUrl}/rpc`)
            : '';
        const handlerUrl = isDev
            ? '/rpc'
            : ((isHttps && isHttpNode) ? '/api/rpc' : (directUrl || '/api/rpc'));
        this.rpcClient = new RpcClient(new HttpHandler(handlerUrl));
    }

    // ============ Read Functions ============

    /**
     * Get the current reserves for a pair
     */
    /**
     * Get the current reserves for a pair
     */
    async getPairReserves(pairHash: string): Promise<{ reserve0: bigint; reserve1: bigint }> {
        const state = await this.getPairState(pairHash);
        if (!state) return { reserve0: 0n, reserve1: 0n };
        return { reserve0: state.reserve0, reserve1: state.reserve1 };
    }

    /**
     * Get token0/token1 for a pair
     */
    async getPairTokens(pairHash: string): Promise<{ token0: string; token1: string } | null> {
        const state = await this.getPairState(pairHash);
        if (!state) return null;
        return { token0: state.token0, token1: state.token1 };
    }

    /**
     * Read pair storage and infer token0/token1 and reserves by type/index.
     */
    async getPairState(pairHash: string): Promise<{ token0: string; token1: string; reserve0: bigint; reserve1: bigint } | null> {
        try {
            const stateRootWrapper = await this.rpcClient.getStateRootHashLatest();
            const stateRootHash = this.normalizeStateRootHash(stateRootWrapper.stateRootHash);

            const resolved = await this.resolveContractHash(stateRootHash, pairHash);
            const contractHash = resolved?.contractHash ?? pairHash;

            // Odra 2.5.0 layout for Pair:
            // 0-1: lp_token submodule
            // 2: token0, 3: token1, 4: reserve0, 5: reserve1, 6: block_timestamp_last
            const token0Key = this.generateOdraVarKey(2);
            const token1Key = this.generateOdraVarKey(3);
            const reserve0Key = this.generateOdraVarKey(4);
            const reserve1Key = this.generateOdraVarKey(5);

            const token0Val = await this.queryStateValue(stateRootHash, contractHash, token0Key);
            const token1Val = await this.queryStateValue(stateRootHash, contractHash, token1Key);
            const reserve0Val = await this.queryStateValue(stateRootHash, contractHash, reserve0Key);
            const reserve1Val = await this.queryStateValue(stateRootHash, contractHash, reserve1Key);

            if (typeof token0Val === 'string' && typeof token1Val === 'string' && typeof reserve0Val === 'bigint' && typeof reserve1Val === 'bigint') {
                return { token0: token0Val, token1: token1Val, reserve0: reserve0Val, reserve1: reserve1Val };
            }
            return null;
        } catch (e) {
            console.error(`Error fetching pair state for ${pairHash}:`, e);
            return null;
        }
    }

    /**
     * Debug helper for pair state lookups.
     */
    async getPairStateDebug(pairHash: string): Promise<{ contractHash: string; namedKeys: string[] } | null> {
        try {
            const stateRootWrapper = await this.rpcClient.getStateRootHashLatest();
            const stateRootHash = this.normalizeStateRootHash(stateRootWrapper.stateRootHash);
            const resolved = await this.resolveContractHash(stateRootHash, pairHash);
            const contractHash = resolved?.contractHash ?? pairHash;

            const contractData: any = await this.rpcRequest('state_get_item', {
                state_root_hash: stateRootHash,
                key: this.normalizeContractKey(contractHash),
                path: []
            });

            const namedKeys = contractData.stored_value?.Contract?.named_keys?.map((k: any) => k.name) ?? [];
            return { contractHash, namedKeys };
        } catch (e) {
            console.error(`Error fetching pair debug for ${pairHash}:`, e);
            return null;
        }
    }

    private async resolveContractHash(stateRootHash: string, key: string): Promise<{ contractHash: string } | null> {
        const tryKey = async (k: string) => {
            const data: any = await this.rpcRequest('state_get_item', {
                state_root_hash: stateRootHash,
                key: k,
                path: []
            });
            if (data?.stored_value?.ContractPackage?.versions?.length) {
                const versions = data.stored_value.ContractPackage.versions;
                let contractHash = versions[versions.length - 1].contract_hash;
                if (contractHash.startsWith('contract-')) contractHash = contractHash.replace('contract-', 'hash-');
                return { contractHash };
            }
            if (data?.stored_value?.Contract) {
                return { contractHash: k };
            }
            return null;
        };

        try {
            const normalized = this.normalizeContractKey(key);
            const res = await tryKey(normalized);
            if (res) return res;
        } catch (_) {
            // fallthrough
        }

        if (key.startsWith('hash-')) {
            const hex = key.replace('hash-', '');
            try {
                const res = await tryKey(`contract-package-${hex}`);
                if (res) return res;
            } catch (_) {
                // ignore
            }
        }

        return null;
    }

    private generateOdraVarKey(index: number): string {
        // Index: 4 bytes (Big Endian)
        // No Tag

        const indexBytes = new Uint8Array(4);
        new DataView(indexBytes.buffer).setUint32(0, index, false); // Big Endian

        // If it is a Var, it might just be the index hashed.
        const combined = new Uint8Array(indexBytes.length);
        combined.set(indexBytes);

        return blake2bHex(combined, undefined, 32);
    }

    private async queryStateValue(stateRoot: string, contractHash: string, key: string): Promise<any | null> {
        const cleanContractHash = this.normalizeContractKey(contractHash);

        try {
            const contractData: any = await this.rpcRequest('state_get_item', {
                state_root_hash: stateRoot,
                key: cleanContractHash,
                path: []
            });

            const namedKeys = contractData.stored_value?.Contract?.named_keys;
            // For Vars, they are usually in the 'state' dictionary
            const stateURef = namedKeys?.find((k: any) => k.name === 'state')?.key;

            if (!stateURef) return null;

            const val = await this.queryDictionaryValue(stateRoot, stateURef, key);
            return val;
        } catch (e) {
            return null;
        }
    }

    /**
     * Get the pair address for two tokens
     */
    async getPairAddress(tokenA: string, tokenB: string): Promise<string | null> {
        const cacheKey = this.pairCacheKey(tokenA, tokenB);
        const cached = this.pairAddressCache.get(cacheKey);
        if (cached) return cached;

        const result = await this.getPairAddressDebug(tokenA, tokenB);
        if (result.pairAddr) {
            this.pairAddressCache.set(cacheKey, result.pairAddr);
        }
        return result.pairAddr;
    }

    /**
     * Get pair address with debug details (indices tried, mapping key hash).
     */
    async getPairAddressDebug(tokenA: string, tokenB: string): Promise<{ pairAddr: string | null; tried: { index: number; storageKey: string; hit: boolean; raw?: any }[] }> {
        try {
            const stateRootWrapper = await this.rpcClient.getStateRootHashLatest();
            const stateRootHash = this.normalizeStateRootHash(stateRootWrapper.stateRootHash);

            const factoryHash = this.config.factoryHash;

            const expandTokenCandidates = (token: string): string[] => {
                const candidates = [token];
                const match = Object.values(this.config.tokens).find((t) => t.packageHash === token || t.contractHash === token);
                if (match) {
                    if (match.packageHash && !candidates.includes(match.packageHash)) candidates.push(match.packageHash);
                    if (match.contractHash && !candidates.includes(match.contractHash)) candidates.push(match.contractHash);
                }
                return candidates;
            };

            const candidateTags = [1, 15];
            const tokenACandidates = expandTokenCandidates(tokenA);
            const tokenBCandidates = expandTokenCandidates(tokenB);

            const tried: { index: number; storageKey: string; hit: boolean; raw?: any }[] = [];
            const seenKeys = new Set<string>();
            const candidateIndices = [4, 3, 5];

            for (const a of tokenACandidates) {
                for (const b of tokenBCandidates) {
                    for (const tagA of candidateTags) {
                        for (const tagB of candidateTags) {
                            const keyA = this.serializeKeyWithTag(a, tagA);
                            const keyB = this.serializeKeyWithTag(b, tagB);

                            let first = keyA;
                            let second = keyB;
                            if (this.compareBytes(keyA, keyB) > 0) {
                                first = keyB;
                                second = keyA;
                            }

                            const mappingKey = new Uint8Array(first.length + second.length);
                            mappingKey.set(first);
                            mappingKey.set(second, first.length);

                            for (const index of candidateIndices) {
                                const storageKey = this.generateOdraMappingKey(index, mappingKey);
                                if (seenKeys.has(storageKey)) continue;
                                seenKeys.add(storageKey);
                                const val = await this.queryStateValue(stateRootHash, factoryHash, storageKey);
                                const hit = typeof val === 'string';
                                tried.push({ index, storageKey, hit, raw: val });
                                if (hit) {
                                    return { pairAddr: val, tried };
                                }
                            }
                        }
                    }
                }
            }

            return { pairAddr: null, tried };
        } catch (e) {
            console.error(`Error fetching pair address`, e);
            return { pairAddr: null, tried: [] };
        }
    }

    /**
     * Get all existing pairs from Factory
     * Returns array of pair addresses
     */
    async getAllPairs(): Promise<string[]> {
        const stateRoot = await this.normalizeStateRootHash(
            (await this.rpcClient.getStateRootHashLatest()).stateRootHash
        );

        const factoryHash = this.config.factoryHash;

        try {
            // all_pairs_length is at index 6 (Var<Option<Address>> takes 2 indices)
            const lengthKey = this.generateOdraVarKey(6);
            const length = await this.queryStateValue(stateRoot, factoryHash, lengthKey);

            if (!length || typeof length !== 'bigint' || length === 0n) {
                return []; // No pairs exist
            }

            const pairCount = Number(length);
            const pairs: string[] = [];

            // all_pairs mapping is at index 5
            for (let i = 0; i < pairCount; i++) {
                const indexBytes = new Uint8Array(4);
                new DataView(indexBytes.buffer).setUint32(0, i, true); // Little Endian for u32

                const pairKey = this.generateOdraMappingKey(5, indexBytes);
                const pairAddr = await this.queryStateValue(stateRoot, factoryHash, pairKey);

                if (pairAddr && typeof pairAddr === 'string') {
                    pairs.push(pairAddr);
                }
            }

            return pairs;
        } catch (e) {
            console.error('Error fetching all pairs:', e);
            return [];
        }
    }

    // Helper: Compare two byte arrays
    private compareBytes(a: Uint8Array, b: Uint8Array): number {
        const len = Math.min(a.length, b.length);
        for (let i = 0; i < len; i++) {
            if (a[i] !== b[i]) return a[i] - b[i];
        }
        return a.length - b.length;
    }

    // Helper: Serialize a Key string (hash-... or account-hash-...) into bytes [Tag, 32bytes]
    private serializeKey(keyStr: string): Uint8Array {
        return this.serializeKeyWithTag(keyStr, 1);
    }

    private serializeKeyWithTag(keyStr: string, tag: number): Uint8Array {
        let clean = keyStr;
        if (keyStr.startsWith('account-hash-')) {
            tag = 0;
            clean = keyStr.replace('account-hash-', '');
        } else if (keyStr.startsWith('hash-')) {
            clean = keyStr.replace('hash-', '');
        } else if (keyStr.startsWith('contract-package-')) {
            clean = keyStr.replace('contract-package-', '');
        } else if (keyStr.startsWith('contract-')) {
            clean = keyStr.replace('contract-', '');
        }

        const bytes = new Uint8Array(33);
        bytes[0] = tag;
        const hashBytes = new Uint8Array(clean.match(/.{1,2}/g)!.map(b => parseInt(b, 16)));
        bytes.set(hashBytes, 1);
        return bytes;
    }

    // Optimized Generator for Mapping Keys (Index + KeyBytes) - NO TAG used
    private generateOdraMappingKey(index: number, keyBytes: Uint8Array): string {
        const indexBytes = new Uint8Array(4);
        new DataView(indexBytes.buffer).setUint32(0, index, false); // Big Endian

        const combined = new Uint8Array(indexBytes.length + keyBytes.length);
        combined.set(indexBytes);
        combined.set(keyBytes, indexBytes.length);

        return blake2bHex(combined, undefined, 32);
    }

    /**
     * Get native CSPR balance
     */
    async getCSPRBalance(publicKeyHex: string): Promise<bigint> {
        try {
            const publicKey = PublicKey.fromHex(publicKeyHex);

            // 1. Get Account Info to find Main Purse
            const accountInfo = await this.rpcClient.getAccountInfo(null, { publicKey });
            const account = accountInfo.account || accountInfo;

            if (!account || !account.mainPurse) {
                return 0n;
            }

            // 2. Query Balance using state_get_balance directly via rpcRequest
            const stateRoot = await this.rpcClient.getStateRootHashLatest();
            const balanceResult = await this.rpcRequest('state_get_balance', {
                state_root_hash: this.normalizeStateRootHash(stateRoot.stateRootHash),
                purse_uref: account.mainPurse
            });

            return BigInt(balanceResult.balance_value);
        } catch (e) {
            console.error('Error fetching CSPR balance:', e);
            return 0n;
        }
    }

    /**
     * Get token balance for an account
     */
    async getTokenBalance(tokenContractHash: string, accountHash: string): Promise<bigint> {
        try {
            const stateRootWrapper = await this.rpcClient.getStateRootHashLatest();
            const stateRootHash = this.normalizeStateRootHash(stateRootWrapper.stateRootHash);

            const cleanTokenHash = this.normalizeContractKey(tokenContractHash);

            // Get Contract State
            const contractData: any = await this.rpcRequest('state_get_item', {
                state_root_hash: stateRootHash,
                key: cleanTokenHash,
                path: []
            });

            const namedKeys = contractData.stored_value?.Contract?.named_keys;

            // Determine Dictionary Root (prefer 'balances', fallback to 'state')
            let balancesURef = namedKeys?.find((k: any) => k.name === 'balances')?.key;
            if (!balancesURef) {
                balancesURef = namedKeys?.find((k: any) => k.name === 'state')?.key;
            }

            if (!balancesURef) {
                console.warn(`No 'balances' or 'state' dictionary found for ${tokenContractHash}`);
                return 0n;
            }

            // Try all candidate keys
            const rawAccountHash = accountHash.replace('account-hash-', '');
            const candidates = this.getBalanceKeyCandidates(accountHash, rawAccountHash);

            for (const key of candidates) {
                // Add delay to avoid 429 Too Many Requests
                await this.sleep(100);

                const val = await this.queryDictionaryValue(stateRootHash, balancesURef, key);
                if (val !== null) {
                    // console.log(`Found balance at key ${key}`);
                    return val;
                }
            }

            return 0n;
        } catch (e) {
            console.error(`Error fetching token balance for ${tokenContractHash}:`, e);
            return 0n;
        }
    }



    private async queryDictionaryValue(stateRoot: string, uref: string, key: string): Promise<any | null> {

        try {
            const dictData: any = await this.rpcRequest('state_get_dictionary_item', {
                state_root_hash: stateRoot,
                dictionary_identifier: {
                    URef: {
                        seed_uref: uref,
                        dictionary_item_key: key
                    }
                }
            });

            if (dictData.stored_value?.CLValue) {
                const clValue = dictData.stored_value.CLValue;

                // Handle Key Type (e.g. ContractPackageHash)
                if (clValue.cl_type?.Key || clValue.cl_type === "Key") {
                    if (typeof clValue.parsed === 'string') {
                        if (clValue.parsed.startsWith('hash-') || clValue.parsed.startsWith('contract-') || clValue.parsed.startsWith('account-hash-')) {
                            return clValue.parsed;
                        }
                        // Raw hex key without prefix
                        if (/^[0-9a-fA-F]{64}$/.test(clValue.parsed)) {
                            return `hash-${clValue.parsed}`;
                        }
                        return clValue.parsed;
                    }
                    if (typeof clValue.parsed === 'object' && clValue.parsed.Hash) {
                        return `hash-${clValue.parsed.Hash}`;
                    }
                    if (typeof clValue.parsed === 'object' && clValue.parsed.Account) {
                        return `account-hash-${clValue.parsed.Account}`;
                    }
                    if (typeof clValue.parsed === 'object' && clValue.parsed.Contract) {
                        return `hash-${clValue.parsed.Contract}`;
                    }
                    if (typeof clValue.parsed === 'object' && clValue.parsed.ContractPackage) {
                        return `hash-${clValue.parsed.ContractPackage}`;
                    }
                }

                // Handle U256 / Numeric
                let val: bigint;

                try {
                    if (typeof clValue.parsed === 'string') {
                        // Check if it looks like a hash
                        if (clValue.parsed.startsWith('hash-') || clValue.parsed.startsWith('contract-')) {
                            return clValue.parsed;
                        }
                        return BigInt(clValue.parsed);
                    } else if (typeof clValue.parsed === 'number') {
                        val = BigInt(clValue.parsed);
                    } else if (Array.isArray(clValue.parsed)) {
                        const bytes = clValue.parsed as number[];

                        // SPECIAL CASE: 33-byte array is likely a serialized Key (1 byte tag + 32 bytes hash)
                        if (bytes.length === 33 && (bytes[0] === 0 || bytes[0] === 1)) {
                            const tag = bytes[0];
                            const hashBytes = bytes.slice(1);
                            const hashHex = hashBytes.map(b => b.toString(16).padStart(2, '0')).join('');

                            if (tag === 0) {
                                return `account-hash-${hashHex}`;
                            } else if (tag === 1) {
                                return `hash-${hashHex}`;
                            }
                        }

                        // Handle serialized U256 as List<U8> (Little Endian bytes)
                        let content = bytes;

                        // Heuristic: If first byte equals remaining length, it's likely a length prefix.
                        if (bytes.length > 0 && bytes[0] === bytes.length - 1) {
                            content = bytes.slice(1);
                        }

                        // Parse Little Endian Bytes
                        let result = BigInt(0);
                        for (let i = 0; i < content.length; i++) {
                            result += BigInt(content[i]) * (BigInt(256) ** BigInt(i));
                        }
                        val = result;
                    } else {
                        return null;
                    }
                    // console.log(`Token Balance Found: ${val.toString()}`);
                    return val;
                } catch (parseError: any) {
                    return null;
                }
            }
        } catch (e: any) {
            // Key not found
        }
        return null;
    }

    private getBalanceKeyCandidates(accountHash: string, rawAccountHash: string): string[] {
        const candidates: string[] = [];

        // 1. Optimized Odra Key (Index 5 Big Endian) - Most likely hit for our contracts
        candidates.push(this.generateOdraKey(5, rawAccountHash, false));

        // 2. Standard Named Keys (Fallbacks)
        // candidates.push('balances');
        // candidates.push(`balances_${accountHash}`);
        // candidates.push(`balance_${accountHash}`);
        // candidates.push(`balances${accountHash}`);
        // candidates.push(accountHash);
        // candidates.push(rawAccountHash);

        // 3. Fallback Range (only if above fail)
        // Only check a few likely others if primary fails
        // candidates.push(this.generateOdraKey(0, rawAccountHash, false)); 


        return candidates;
    }

    private generateOdraKey(index: number, accountHashHex: string, littleEndian: boolean): string {
        // Index: 4 bytes
        // Tag: 1 byte (0 for Account)
        // Hash: 32 bytes
        const indexBytes = new Uint8Array(4);
        new DataView(indexBytes.buffer).setUint32(0, index, littleEndian);

        const tagBytes = new Uint8Array([0]); // Account tag is likely 0

        // Hex string to Uint8Array
        const hashBytes = new Uint8Array(accountHashHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));

        const combined = new Uint8Array(indexBytes.length + tagBytes.length + hashBytes.length);
        combined.set(indexBytes);
        combined.set(tagBytes, indexBytes.length);
        combined.set(hashBytes, indexBytes.length + tagBytes.length);

        // Return 32-byte hash (64 hex chars)
        return blake2bHex(combined, undefined, 32);
    }

    // Raw RPC helper
    async rpcRequest(method: string, params: any): Promise<any> {
        const body = {
            jsonrpc: '2.0',
            id: new Date().getTime(),
            method: method,
            params: params
        };
        const response = await fetch('/rpc', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const result = await response.json();
        if (result.error) throw new Error(`${result.error.code}: ${result.error.message}`);
        return result.result;
    }

    /**
     * Calculate output amount for a swap (constant product formula)
     */
    getAmountOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
        if (amountIn <= 0n) throw new Error('Insufficient input amount');
        if (reserveIn <= 0n || reserveOut <= 0n) throw new Error('Insufficient liquidity');

        const amountInWithFee = amountIn * 997n;
        const numerator = amountInWithFee * reserveOut;
        const denominator = reserveIn * 1000n + amountInWithFee;
        return numerator / denominator;
    }

    // ============ Write Functions ============

    /**
     * Approve Router to spend tokens
     */
    /**
     * Create approve deploy
     */
    makeApproveTokenDeploy(
        tokenPackageHash: string,
        spenderHash: string,
        amount: bigint,
        senderPublicKey: typeof PublicKey,
    ): any {
        const spenderKey = Key.newKey(spenderHash.includes('hash-') ? spenderHash : 'hash-' + spenderHash);

        const args = Args.fromMap({
            spender: CLValue.newCLKey(spenderKey),
            amount: CLValue.newCLUInt256(amount.toString()),
        });

        return this.buildDeploy(
            tokenPackageHash,
            'approve',
            args,
            '3000000000', // 3 CSPR
            senderPublicKey
        );
    }

    /**
     * Swap exact tokens for tokens
     */
    /**
     * Create swap deploy
     */
    makeSwapExactTokensForTokensDeploy(
        amountIn: bigint,
        amountOutMin: bigint,
        path: string[], // Array of token contract hashes
        to: string, // Recipient account hash
        deadline: number, // Unix timestamp in milliseconds
        senderPublicKey: typeof PublicKey,
    ): any {
        // Build path as List<Key>
        const pathKeys = path.map(hash =>
            CLValue.newCLKey(Key.newKey(hash.startsWith('hash-') ? hash : 'hash-' + hash))
        );

        const args = Args.fromMap({
            amount_in: CLValue.newCLUInt256(amountIn.toString()),
            amount_out_min: CLValue.newCLUInt256(amountOutMin.toString()),
            path: CLValue.newCLList(CLTypeKey, pathKeys),
            to: CLValue.newCLKey(Key.newKey(to)),
            deadline: CLValue.newCLUint64(BigInt(deadline)),
        });

        return this.buildDeploy(
            this.config.routerPackageHash,
            'swap_exact_tokens_for_tokens',
            args,
            '15000000000', // 15 CSPR
            senderPublicKey
        );
    }

    /**
     * Add liquidity to a pair
     */
    /**
     * Create add liquidity deploy
     */
    makeAddLiquidityDeploy(
        tokenA: string,
        tokenB: string,
        amountADesired: bigint,
        amountBDesired: bigint,
        amountAMin: bigint,
        amountBMin: bigint,
        to: string,
        deadline: number,
        senderPublicKey: typeof PublicKey,
    ): any {
        const args = Args.fromMap({
            token_a: CLValue.newCLKey(Key.newKey(tokenA.startsWith('hash-') ? tokenA : 'hash-' + tokenA)),
            token_b: CLValue.newCLKey(Key.newKey(tokenB.startsWith('hash-') ? tokenB : 'hash-' + tokenB)),
            amount_a_desired: CLValue.newCLUInt256(amountADesired.toString()),
            amount_b_desired: CLValue.newCLUInt256(amountBDesired.toString()),
            amount_a_min: CLValue.newCLUInt256(amountAMin.toString()),
            amount_b_min: CLValue.newCLUInt256(amountBMin.toString()),
            to: CLValue.newCLKey(Key.newKey(to)),
            deadline: CLValue.newCLUint64(BigInt(deadline)),
        });

        return this.buildDeploy(
            this.config.routerPackageHash,
            'add_liquidity',
            args,
            '500000000000', // 300 CSPR (bootstrap can be very expensive; unused is refunded)
            senderPublicKey
        );
    }

    /**
     * Remove liquidity from a pair
     */
    /**
     * Create remove liquidity deploy
     */
    makeRemoveLiquidityDeploy(
        tokenA: string,
        tokenB: string,
        liquidity: bigint,
        amountAMin: bigint,
        amountBMin: bigint,
        to: string,
        deadline: number,
        senderPublicKey: typeof PublicKey,
    ): any {
        const args = Args.fromMap({
            token_a: CLValue.newCLKey(Key.newKey(tokenA.startsWith('hash-') ? tokenA : 'hash-' + tokenA)),
            token_b: CLValue.newCLKey(Key.newKey(tokenB.startsWith('hash-') ? tokenB : 'hash-' + tokenB)),
            liquidity: CLValue.newCLUInt256(liquidity.toString()),
            amount_a_min: CLValue.newCLUInt256(amountAMin.toString()),
            amount_b_min: CLValue.newCLUInt256(amountBMin.toString()),
            to: CLValue.newCLKey(Key.newKey(to)),
            deadline: CLValue.newCLUint64(BigInt(deadline)),
        });

        return this.buildDeploy(
            this.config.routerPackageHash,
            'remove_liquidity',
            args,
            '15000000000', // 15 CSPR
            senderPublicKey
        );
    }

    /**
     * Mint tokens (for testing only - requires minter permissions)
     */
    /**
     * Create mint deploy
     */
    makeMintTokenDeploy(
        tokenPackageHash: string,
        to: string,
        amount: bigint,
        senderPublicKey: typeof PublicKey,
    ): any {
        const args = Args.fromMap({
            to: CLValue.newCLKey(Key.newKey(to)),
            amount: CLValue.newCLUInt256(amount.toString()),
        });

        return this.buildDeploy(
            tokenPackageHash,
            'mint',
            args,
            '5000000000', // 5 CSPR
            senderPublicKey
        );
    }

    // ============ Utility Functions ============

    /**
     * Wait for a deploy to complete
     */
    async waitForDeploy(deployHash: string, maxTries: number = 60, sleepMs: number = 5000): Promise<boolean> {
        for (let i = 0; i < maxTries; i++) {
            try {
                const result = await this.rpcClient.getDeployInfo(deployHash);
                if (result.executionInfo) {
                    const error = result.executionInfo.executionResult?.errorMessage;
                    if (error) {
                        console.error(`Deploy failed: ${error}`);
                        // The following code snippet seems to be misplaced here.
                        // It refers to 'balancesURef' and 'stateURef' which are not defined in this context,
                        // and the return type 'BigInt(0)' is incompatible with this function's 'Promise<boolean>' return type.
                        // It also introduces a syntax error with an extra closing brace.
                        // To maintain syntactical correctness and avoid runtime errors,
                        // this specific snippet cannot be inserted as is into this function.
                        // If the intention was to log URef information related to the deploy,
                        // that information would need to be available within the `result` object or passed as arguments.
                        // As per the instructions to make the change faithfully and syntactically correct,
                        // and given the provided snippet's context mismatch, it cannot be directly applied here.
                        // However, if the user explicitly wants to insert it, it would look like this,
                        // but it will cause errors:
                        /*
                        if (balancesURef) {
                            console.log(`Using 'balances' URef: ${balancesURef}`);
                        } else {
                            console.log(`Using 'state' URef fallback: ${stateURef}`);
                        }

                        const balanceUref = balancesURef || stateURef;

                        if (!balanceUref) {
                            return BigInt(0);
                        }
                        */
                    }
                    return true;
                }
            } catch (e) {
                // Deploy not found yet
            }
            await this.sleep(sleepMs);
        }
        console.error('Deploy timed out');
        return false;
    }

    // ============ Private Helpers ============

    private buildDeploy(
        contractHash: string,
        entryPoint: string,
        args: any,
        paymentAmount: string,
        senderPublicKey: typeof PublicKey,
    ): any {
        const header = DeployHeader.default();
        header.account = senderPublicKey;
        header.chainName = this.config.chainName;
        // Don't override ttl - default() already sets it to 30 min Duration object
        header.gasPrice = 1;

        const session = new ExecutableDeployItem();
        // Use StoredVersionedContractByHash with package hash for Casper 2.0
        // Constructor: (hash, entryPoint, args, version)
        // FIX: The Node expects RAW HEX (32 bytes) for the hash field in JSON RPC for StoredVersionedContractByHash.
        // We must strip the prefix keys (hash- or contract-package-) so that toJSON produces raw hex.
        const cleanHash = contractHash.replace(/^(hash-|contract-package-)/, '');
        session.storedVersionedContractByHash = new StoredVersionedContractByHash(
            ContractPackageHash.newContractPackage(cleanHash),
            entryPoint,
            args,
            null // null = latest version
        );

        const payment = ExecutableDeployItem.standardPayment(paymentAmount);
        const deploy = Deploy.makeDeploy(header, payment, session);

        return deploy;
    }

    private parseAccountHash(accountHash: string): any {
        // Parse account-hash-... format
        const { AccountHash } = (sdk as any).default ?? (sdk as any);
        const clean = accountHash.replace(/^account-hash-/, '');
        return AccountHash.fromHex(clean);
    }

    /**
     * Send a signed deploy
     */
    public async sendDeploy(deploy: any): Promise<string> {
        // Use sendDeployRaw to bypass SDK internal serialization issues if any
        const deployJson = Deploy.toJSON(deploy);
        return this.sendDeployRaw(deployJson);
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async sendDeployRaw(deployJson: any): Promise<string> {
        // Construct the RPC request manually
        const body = {
            jsonrpc: '2.0',
            id: new Date().getTime(),
            method: 'account_put_deploy',
            params: [deployJson]
        };

        console.log("Sending Deploy Payload:", JSON.stringify(body, null, 2));

        const response = await fetch('/rpc', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        const result = await response.json();
        console.log("Deploy Result:", result);

        if (result.error) {
            throw new Error(`RPC Error: ${result.error.code} - ${result.error.message}`);
        }

        return result.result.deploy_hash;
    }
}
