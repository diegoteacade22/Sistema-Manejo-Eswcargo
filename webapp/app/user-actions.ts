'use server';

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { revalidatePath } from 'next/cache';

const prisma = new PrismaClient();

export async function createUser(data: any) {
    try {
        const { name, username, email, password, role, clientId } = data;

        // Validations
        if (!username || !password) {
            return { success: false, message: 'Username and password are required' };
        }

        // Check if user exists
        const existingUser = await prisma.user.findFirst({
            where: {
                OR: [
                    { username },
                    { email: email || undefined }
                ]
            }
        });

        if (existingUser) {
            return { success: false, message: 'Username or email already exists' };
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create user
        const newUser = await prisma.user.create({
            data: {
                name,
                username,
                email,
                password: hashedPassword,
                role: role || 'CLIENT',
            }
        });

        // Link to Client if provided
        if (clientId && role === 'CLIENT') {
            await prisma.client.update({
                where: { id: parseInt(clientId) },
                data: { userId: newUser.id }
            });
        }

        revalidatePath('/maintenance');
        revalidatePath('/maintenance/users');
        return { success: true, message: 'User created successfully' };
    } catch (error: any) {
        console.error("Create User Error:", error);
        return { success: false, message: error.message };
    }
}

export async function getUsers() {
    try {
        const users = await prisma.user.findMany({
            include: {
                client: true
            },
            orderBy: { createdAt: 'desc' }
        });
        return { success: true, data: users };
    } catch (error: any) {
        return { success: false, message: error.message };
    }
}

export async function generateClientCredentials(clientId: number) {
    try {
        const client = await prisma.client.findUnique({
            where: { id: clientId },
            include: { user: true }
        });

        if (!client) return { success: false, message: 'Cliente no encontrado' };
        if (client.userId) return { success: false, message: 'El cliente ya tiene un usuario asignado.' };
        if (!client.email) return { success: false, message: 'El cliente necesita un email para generar usuario.' };

        // Generate Username (Email)
        const username = client.email;

        // Generate Password (Simple for now: Name123!)
        // Clean name to be first word only, capitalized
        const cleanName = client.name.split(' ')[0].replace(/[^a-zA-Z]/g, '');
        const passwordRaw = `${cleanName}123!`;
        const hashedPassword = await bcrypt.hash(passwordRaw, 10);

        // Create User
        const newUser = await prisma.user.create({
            data: {
                name: client.name,
                username: username,
                email: username,
                password: hashedPassword,
                role: 'CLIENT'
            }
        });

        // Link to Client
        await prisma.client.update({
            where: { id: clientId },
            data: { userId: newUser.id, canAccess: true }
        });

        revalidatePath('/clients');
        return {
            success: true,
            credentials: {
                username: username,
                password: passwordRaw
            }
        };

    } catch (error: any) {
        console.error("Generate Credentials Error:", error);
        return { success: false, message: error.message };
    }
}
