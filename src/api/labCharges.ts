import { api } from '@/lib/api';

export type LabChargeInput = { name: string; isActive: boolean } & (
  { kind: 'TECHNICIAN'; amount: number } |
  { kind: 'KM'; distanceKm: number } |
  { kind: 'DISTANCE'; firstKm: number; firstAmount: number; secondKm: number; secondAmount: number; extraPerKm: number }
);
export type LabCharge = LabChargeInput & { id: number; amount?: number; rateId?: number };
const base = '/v1/staff/lab-charges';
export const listLabCharges = (token?: string | null) => api.get<LabCharge[]>(base, token);
export const saveLabCharge = (id: number | null, input: LabChargeInput, token?: string | null) =>
  id == null ? api.post<LabCharge>(base, input, token) : api.patch<LabCharge>(`${base}/${id}`, input, token);
export const deleteLabCharge = (id: number, token?: string | null) => api.delete(`${base}/${id}`, token);
