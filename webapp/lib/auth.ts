
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { authConfig } from "@/auth.config";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

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
                const username = credentials?.username?.toString().toLowerCase().trim();
                const password = credentials?.password?.toString();
                const host = request?.headers?.get('host') || '';

                console.log(`[AUTH] Intento de login: "${username}"`);

                // Bypass opcional solo para entorno de desarrollo controlado.
                const allowedBypassHosts = ['localhost', '127.0.0.1', 'dev.eswtech.net'];
                const hostAllowed = allowedBypassHosts.some(h => host.includes(h));
                const allowDevBypass = process.env.ALLOW_ADMIN_DEV_BYPASS === 'true' && hostAllowed;
                if (allowDevBypass && (username === 'admin' || username === 'admin@eswcargo.com')) {
                    console.warn("⚠️ [AUTH] BYPASS ADMIN DEV ACTIVADO");
                    const adminUser = await prisma.user.findFirst({
                        where: {
                            OR: [
                                { username: 'admin' },
                                { email: 'admin@eswcargo.com' }
                            ]
                        }
                    });

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
                    role: user.role,
                };
            },
        }),
    ],
});
