import { Response, NextFunction } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { AppError } from '../../middleware/errorHandler';
import {
  SETTINGS_FIELDS,
  SETTINGS_GROUPS,
  ValidationError,
} from './settings.schema';
import {
  getMaskedSettings,
  updateSettings,
  resetSettings,
} from './settings.service';

export class SettingsController {
  /** Field/group metadata driving the frontend form. Public to any authed user. */
  async getSchema(_req: AuthRequest, res: Response, next: NextFunction) {
    try {
      res.json({ status: 'success', data: { groups: SETTINGS_GROUPS, fields: SETTINGS_FIELDS } });
    } catch (error) {
      next(error);
    }
  }

  /** Current effective settings with secrets masked. */
  async getSettings(_req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const settings = await getMaskedSettings();
      res.json({ status: 'success', data: settings });
    } catch (error) {
      next(error);
    }
  }

  /** Apply a settings patch. Admin only (enforced by route middleware). */
  async updateSettings(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const updated = await updateSettings(req.body);
      res.json({ status: 'success', data: updated });
    } catch (error) {
      if (error instanceof ValidationError) {
        return next(new AppError(error.message, 400));
      }
      next(error);
    }
  }

  /** Revert all settings to code/env defaults. Admin only. */
  async resetSettings(_req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const defaults = await resetSettings();
      res.json({ status: 'success', data: defaults });
    } catch (error) {
      next(error);
    }
  }
}

export const settingsController = new SettingsController();
