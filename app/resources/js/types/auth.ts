export type User = {
    id: number;
    username: string;
    name: string;
    email: string | null;
    avatar?: string;
    email_verified_at: string | null;
    role: 'super_admin' | 'admin' | 'moderator' | 'player';
    two_factor_enabled?: boolean;
    created_at: string;
    updated_at: string;
    [key: string]: unknown;
};

export type Auth = {
    user: User;
};

export type TwoFactorSetupData = {
    svg: string;
    url: string;
};

export type TwoFactorSecretKey = {
    secretKey: string;
};
