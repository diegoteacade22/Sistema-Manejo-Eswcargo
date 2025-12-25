
'use server';

import { signIn } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { AuthError } from "next-auth";

export async function authenticate(
    prevState: string | undefined,
    formData: FormData,
) {
    try {
        await signIn('credentials', formData);
    } catch (error) {
        if (error instanceof AuthError) {
            switch (error.type) {
                case 'CredentialsSignin':
                    return 'Credenciales inválidas.';
                default:
                    return 'Algo salió mal.';
            }
        }
        throw error;
    }
}

export async function setupClientAccount(formData: FormData) {
    const clientNumber = formData.get('clientNumber') as string;
    const password = formData.get('password') as string;
    const email = formData.get('email') as string;
    const instagram = formData.get('instagram') as string;
    const city = formData.get('city') as string;
    const state = formData.get('state') as string;
    const phone = formData.get('phone') as string;
    const storeName = formData.get('storeName') as string;

    if (!clientNumber || !password) {
        return { success: false, error: 'Número de cliente y contraseña son obligatorios.' };
    }

    try {
        // 1. Check if client exists in Excel-synced data
        const client = await prisma.client.findFirst({
            where: { old_id: parseInt(clientNumber) }
        });

        if (!client) {
            return { success: false, error: 'Número de cliente no encontrado. Por favor contacte a soporte.' };
        }

        if ((client as any).userId) {
            return { success: false, error: 'Esta cuenta ya está activa. Por favor inicie sesión.' };
        }

        // 2. Create User
        const hashedPassword = await bcrypt.hash(password, 10);
        const user = await (prisma as any).user.create({
            data: {
                username: clientNumber,
                password: hashedPassword,
                name: storeName || client.name,
                email: email || client.email,
                role: 'CLIENT'
            }
        });

        // 3. Link user to client and update additional fields
        await (prisma.client as any).update({
            where: { id: client.id },
            data: {
                userId: user.id,
                instagram,
                city,
                state,
                phone,
                email: email || client.email,
                name: storeName || client.name
            }
        });

        return { success: true };
    } catch (e) {
        console.error(e);
        return { success: false, error: 'Error al crear la cuenta.' };
    }
}
