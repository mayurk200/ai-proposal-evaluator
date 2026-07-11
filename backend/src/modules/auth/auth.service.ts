import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { collections } from '../../config/database';
import { env } from '../../config/env';
import { RegisterInput, LoginInput } from './auth.schema';
import { AppError } from '../../middleware/errorHandler';

export class AuthService {
  async register(data: RegisterInput) {
    // Check if user exists
    const existingSnap = await collections.users.where('email', '==', data.email).limit(1).get();
    if (!existingSnap.empty) {
      throw new AppError('Email already registered', 409);
    }

    const hashedPassword = await bcrypt.hash(data.password, 12);
    const id = randomUUID();
    const now = new Date().toISOString();

    const userData = {
      id,
      email: data.email,
      name: data.name,
      company: data.company || null,
      role: 'USER',
      password: hashedPassword,
      createdAt: now,
      updatedAt: now,
    };

    await collections.users.doc(id).set(userData);

    const { password: _, ...userWithoutPassword } = userData;
    const token = this.generateToken(id, 'USER');

    return { user: userWithoutPassword, token };
  }

  async login(data: LoginInput) {
    const snapshot = await collections.users.where('email', '==', data.email).limit(1).get();

    if (snapshot.empty) {
      throw new AppError('Invalid email or password', 401);
    }

    const userDoc = snapshot.docs[0];
    const user = userDoc.data();

    const isPasswordValid = await bcrypt.compare(data.password, user.password);
    if (!isPasswordValid) {
      throw new AppError('Invalid email or password', 401);
    }

    const token = this.generateToken(user.id, user.role);
    const { password: _, ...userWithoutPassword } = user;

    return { user: userWithoutPassword, token };
  }

  async getProfile(userId: string) {
    const doc = await collections.users.doc(userId).get();

    if (!doc.exists) {
      throw new AppError('User not found', 404);
    }

    const user = doc.data()!;
    const { password: _, ...userWithoutPassword } = user;

    // Count proposals
    const proposalCount = await collections.proposals.where('userId', '==', userId).count().get();

    return {
      ...userWithoutPassword,
      _count: { proposals: proposalCount.data().count },
    };
  }

  private generateToken(userId: string, role: string): string {
    return jwt.sign({ userId, role }, env.JWT_SECRET, { expiresIn: '7d' });
  }
}

export const authService = new AuthService();
