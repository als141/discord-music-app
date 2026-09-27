'use client';

import { AdminDashboard } from '@/components/admin/AdminDashboard';

// ログインは proxy.ts（withAuth）で必須。管理者かどうかはバックエンドが判定し、違えば 403 を表示する
export default function AdminPage() {
  return <AdminDashboard />;
}
