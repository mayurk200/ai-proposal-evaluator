import api from './api';

export type FieldType = 'text' | 'textarea' | 'number' | 'boolean' | 'select' | 'secret';

export interface SettingsField {
  id: string;
  group: string;
  key: string;
  label: string;
  description?: string;
  type: FieldType;
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  placeholder?: string;
  secret?: boolean;
  appliesLive: boolean;
  consumedBy: 'backend' | 'python' | 'both' | 'ui';
  danger?: boolean;
}

export interface SettingsGroup {
  id: string;
  label: string;
  description: string;
  icon: string;
}

export interface SettingsSchema {
  groups: SettingsGroup[];
  fields: SettingsField[];
}

export type SettingsValue = string | number | boolean;
export type SettingsData = Record<string, Record<string, SettingsValue>>;

export const settingsService = {
  async getSchema(): Promise<SettingsSchema> {
    const { data } = await api.get('/settings/schema');
    return data.data;
  },

  async getSettings(): Promise<SettingsData> {
    const { data } = await api.get('/settings');
    return data.data;
  },

  async updateSettings(patch: SettingsData): Promise<SettingsData> {
    const { data } = await api.put('/settings', patch);
    return data.data;
  },

  async resetSettings(): Promise<SettingsData> {
    const { data } = await api.post('/settings/reset');
    return data.data;
  },
};
