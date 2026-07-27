import { Request, Response, NextFunction } from 'express';
import { authService } from './auth.service';
import { loginSchema, createUserSchema } from './auth.schema';
import { AuthRequest } from '../../middleware/auth';

export class AuthController {
  async login(req: Request, res: Response, next: NextFunction) {
    try {
      const data = loginSchema.parse(req.body);
      const result = await authService.login(data);
      res.json({ status: 'success', data: result });
    } catch (error) {
      next(error);
    }
  }

  async getProfile(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const user = await authService.getProfile(req.userId!);
      res.json({ status: 'success', data: user });
    } catch (error) {
      next(error);
    }
  }

  /** ADMIN only. */
  async createUser(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const data = createUserSchema.parse(req.body);
      const user = await authService.createUser(data);
      res.status(201).json({ status: 'success', data: user });
    } catch (error) {
      next(error);
    }
  }

  /** ADMIN only. */
  async listUsers(_req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const users = await authService.listUsers();
      res.json({ status: 'success', data: users });
    } catch (error) {
      next(error);
    }
  }
}

export const authController = new AuthController();
