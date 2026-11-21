import { createEnv } from '@t3-oss/env-nextjs'
import { z } from 'zod'

export const env = createEnv({
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  server: {
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
    ADMIN_SECRET: z.string().min(16).optional(),
    // Comma-separated list of allowed CORS origins.
    // Example: https://solarproof.vercel.app,https://staging.solarproof.vercel.app
    CORS_ALLOWED_ORIGINS: z.string().optional(),
    // Secrets Manager ARN for the active minter key (production)
    MINTER_SECRET_ARN: z.string().min(1).optional(),
    // ARN of the previous key — set during the 24-h rotation grace window
    MINTER_PREVIOUS_SECRET_ARN: z.string().min(1).optional(),
    // Fallback for local dev only — ignored when MINTER_SECRET_ARN is set
    MINTER_SECRET_KEY: z.string().min(56).optional(),
    AWS_REGION: z.string().default('us-east-1'),
    READINGS_RATE_LIMIT_PER_MINUTE: z.string().optional(),
    READINGS_RATE_LIMIT_WINDOW_SECONDS: z.string().optional(),
    WEBHOOK_SECRET: z.string().min(16).optional(),
    // EVM/Polygon certificate NFT minting (optional, opt-in per cooperative)
    EVM_NFT_MINTING_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    EVM_RPC_URL: z.string().url().optional(),
    EVM_PRIVATE_KEY: z.string().min(1).optional(),
    EVM_CERTIFICATE_NFT_ADDRESS: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/, 'Must be a valid EVM address')
      .optional(),
    EVM_CHAIN_ID: z.string().optional(),
  },
  client: {
    NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
    NEXT_PUBLIC_STELLAR_NETWORK: z.enum(['testnet', 'mainnet']).default('testnet'),
    NEXT_PUBLIC_STELLAR_RPC_URL: z.string().url().default('https://soroban-testnet.stellar.org'),
    NEXT_PUBLIC_ENERGY_TOKEN_ID: z.string().min(1),
    NEXT_PUBLIC_AUDIT_REGISTRY_ID: z.string().min(1),
    NEXT_PUBLIC_COMMUNITY_GOVERNANCE_ID: z.string().min(1),
  },
  runtimeEnv: {
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    ADMIN_SECRET: process.env.ADMIN_SECRET,
    CORS_ALLOWED_ORIGINS: process.env.CORS_ALLOWED_ORIGINS,
    MINTER_SECRET_ARN: process.env.MINTER_SECRET_ARN,
    MINTER_PREVIOUS_SECRET_ARN: process.env.MINTER_PREVIOUS_SECRET_ARN,
    MINTER_SECRET_KEY: process.env.MINTER_SECRET_KEY,
    AWS_REGION: process.env.AWS_REGION,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_STELLAR_NETWORK: process.env.NEXT_PUBLIC_STELLAR_NETWORK,
    NEXT_PUBLIC_STELLAR_RPC_URL: process.env.NEXT_PUBLIC_STELLAR_RPC_URL,
    NEXT_PUBLIC_ENERGY_TOKEN_ID: process.env.NEXT_PUBLIC_ENERGY_TOKEN_ID,
    NEXT_PUBLIC_AUDIT_REGISTRY_ID: process.env.NEXT_PUBLIC_AUDIT_REGISTRY_ID,
    NEXT_PUBLIC_COMMUNITY_GOVERNANCE_ID: process.env.NEXT_PUBLIC_COMMUNITY_GOVERNANCE_ID,
    READINGS_RATE_LIMIT_PER_MINUTE: process.env.READINGS_RATE_LIMIT_PER_MINUTE,
    READINGS_RATE_LIMIT_WINDOW_SECONDS: process.env.READINGS_RATE_LIMIT_WINDOW_SECONDS,
    WEBHOOK_SECRET: process.env.WEBHOOK_SECRET,
    EVM_NFT_MINTING_ENABLED: process.env.EVM_NFT_MINTING_ENABLED,
    EVM_RPC_URL: process.env.EVM_RPC_URL,
    EVM_PRIVATE_KEY: process.env.EVM_PRIVATE_KEY,
    EVM_CERTIFICATE_NFT_ADDRESS: process.env.EVM_CERTIFICATE_NFT_ADDRESS,
    EVM_CHAIN_ID: process.env.EVM_CHAIN_ID,
  },
})
