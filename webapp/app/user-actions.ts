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
