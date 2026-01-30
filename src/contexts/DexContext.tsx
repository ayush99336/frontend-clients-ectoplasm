import React, { createContext, useContext, useState } from 'react';
import { DexClient, type DexConfig } from '../dex-client';

// Configuration from Environment Variables
const ENV = import.meta.env as any;
const CONFIG: DexConfig = {
    nodeUrl: ENV.NODE_ADDRESS || ENV.VITE_NODE_ADDRESS || '',
    chainName: ENV.CHAIN_NAME || ENV.VITE_CHAIN_NAME || '',
    routerPackageHash: ENV.ROUTER_PACKAGE_HASH || ENV.VITE_ROUTER_PACKAGE_HASH || '',
    routerContractHash: ENV.ROUTER_CONTRACT_HASH || ENV.VITE_ROUTER_CONTRACT_HASH || '',
    factoryHash: ENV.FACTORY_CONTRACT_HASH || ENV.VITE_FACTORY_CONTRACT_HASH || '',
    tokens: {
        WCSPR: {
            packageHash: ENV.WCSPR_PACKAGE_HASH || ENV.VITE_WCSPR_PACKAGE_HASH || '',
            contractHash: ENV.WCSPR_CONTRACT_HASH || ENV.VITE_WCSPR_CONTRACT_HASH || '',
            decimals: 18,
        },
        ECTO: {
            packageHash: ENV.ECTO_PACKAGE_HASH || ENV.VITE_ECTO_PACKAGE_HASH || '',
            contractHash: ENV.ECTO_CONTRACT_HASH || ENV.VITE_ECTO_CONTRACT_HASH || '',
            decimals: 18,
        },
        USDC: {
            packageHash: ENV.USDC_PACKAGE_HASH || ENV.VITE_USDC_PACKAGE_HASH || '',
            contractHash: ENV.USDC_CONTRACT_HASH || ENV.VITE_USDC_CONTRACT_HASH || '',
            decimals: 6,
        },
        WETH: {
            packageHash: ENV.WETH_PACKAGE_HASH || ENV.VITE_WETH_PACKAGE_HASH || '',
            contractHash: ENV.WETH_CONTRACT_HASH || ENV.VITE_WETH_CONTRACT_HASH || '',
            decimals: 18,
        },
        WBTC: {
            packageHash: ENV.WBTC_PACKAGE_HASH || ENV.VITE_WBTC_PACKAGE_HASH || '',
            contractHash: ENV.WBTC_CONTRACT_HASH || ENV.VITE_WBTC_CONTRACT_HASH || '',
            decimals: 8,
        },
        sCSPR: {
            packageHash: ENV.SCSPR_PACKAGE_HASH || ENV.VITE_SCSPR_PACKAGE_HASH || '',
            contractHash: ENV.SCSPR_CONTRACT_HASH || ENV.VITE_SCSPR_CONTRACT_HASH || '',
            decimals: 9,
        },
    },
    pairs: {
        'WCSPR-ECTO': 'dynamic', // Placeholder
    }
};

interface DexContextType {
    dex: DexClient;
    config: DexConfig;
}

const DexContext = createContext<DexContextType | null>(null);

export const DexProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [dex] = useState(() => new DexClient(CONFIG));

    return (
        <DexContext.Provider value={{ dex, config: CONFIG }}>
            {children}
        </DexContext.Provider>
    );
};

export const useDex = () => {
    const context = useContext(DexContext);
    if (!context) throw new Error("useDex must be used within DexProvider");
    return context;
};
