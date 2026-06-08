
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { authConfig } from "@/auth.config";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

function normalize(value: string | undefined) {
    return value?.toLowerCase().trim() || "";
}

export const { handlers, auth, signIn, signOut } = NextAuth({
    ...authConfig,
    providers: [
        Credentials({
            name: "Client Number",
            credentials: {
                username: { label: "Usuario (Admin o Nro Cliente)", type: "text" },
                password: { label: "Contraseña", type: "password" },
            },
            async authorize(credentials, request) {
                const username = normalize(credentials?.username?.toString());
                const password = credentials?.password?.toString();
                const host = request?.headers?.get('host') || '';

                console.log(`[AUTH] Intento de login: "${username}"`);

                // Bypass opcional solo para entorno de desarrollo controlado.
                const allowedBypassHosts = ['localhost', '127.0.0.1', 'dev.eswtech.net'];
                const hostAllowed = allowedBypassHosts.some(h => host.includes(h));
                const allowDevBypass = process.env.ALLOW_ADMIN_DEV_BYPASS === 'true' && hostAllowed;
                if (allowDevBypass && (username === 'admin' || username === 'admin@eswcargo.com')) {
                    console.warn("⚠️ [AUTH] BYPASS ADMIN DEV ACTIVADO");
                    let adminUser: any = null;
                    if (process.env.DATABASE_URL) {
                        try {
                            adminUser = await prisma.user.findFirst({
                                where: {
                                    OR: [
                                        { username: 'admin' },
                                        { email: 'admin@eswcargo.com' }
                                    ]
                                }
                            });
                        } catch (error) {
                            console.warn("⚠️ [AUTH] No se pudo cargar admin desde BD en bypass dev:", error);
                        }
                    }

                    return {
                        id: adminUser?.id || "admin-dev-bypass",
                        name: adminUser?.name || "Administrador",
                        email: adminUser?.email || "admin@eswcargo.com",
                        role: "ADMIN",
                    };
                }

                if (!username || !password) {
                    console.log("❌ [AUTH] Credenciales faltantes");
                    return null;
                }

                const allowEmergencyAdmin = process.env.ALLOW_ADMIN_EMERGENCY_LOGIN === 'true';
                const emergencyUsername = normalize(process.env.ADMIN_EMERGENCY_USERNAME || 'admin');
                const emergencyEmail = normalize(process.env.ADMIN_EMERGENCY_EMAIL || 'admin@eswcargo.com');
                const emergencyPassword = process.env.ADMIN_EMERGENCY_PASSWORD;
                const isAdminIdentity = username === 'admin'
                    || username === 'admin@eswcargo.com'
                    || username === emergencyUsername
                    || username === emergencyEmail;

                if (allowEmergencyAdmin && emergencyPassword && (username === emergencyUsername || username === emergencyEmail)) {
                    const isEmergencyPasswordValid = password === emergencyPassword;
                    if (isEmergencyPasswordValid) {
                        console.warn("⚠️ [AUTH] LOGIN ADMIN EMERGENCIA ACTIVADO");
                        const adminUser = await prisma.user.findFirst({
                            where: {
                                OR: [
                                    { username: emergencyUsername },
                                    { email: emergencyEmail },
                                    { role: 'ADMIN' },
                                ],
                            },
                        });

                        return {
                            id: adminUser?.id || 'admin-emergency-login',
                            name: adminUser?.name || 'Administrador',
                            email: adminUser?.email || emergencyEmail,
                            role: 'ADMIN',
                        };
                    }
                }

                const user = await (prisma as any).user.findUnique({
                    where: { username },
                });

                if (!user || !user.password) {
                    console.log("User not found or no password");
                    return null;
                }

                const isPasswordValid = await bcrypt.compare(
                    password,
                    user.password
                );

                console.log("Password valid:", isPasswordValid);

                if (!isPasswordValid) return null;

                return {
                    id: user.id,
                    name: user.name,
                    email: user.email,
                    role: isAdminIdentity ? "ADMIN" : user.role,
                };
            },
        }),
    ],
});
