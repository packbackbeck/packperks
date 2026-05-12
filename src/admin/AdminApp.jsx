import { useState } from 'react';
import AdminTopBar from './AdminTopBar';
import AdminSidebar from './AdminSidebar';
import AdminOverview from './overview/AdminOverview';
import AdminRewards from './rewards/AdminRewards';
import AdminUsers from './users/AdminUsers';
import AdminClaims from './claims/AdminClaims';
import AdminCupScans from './cupscans/AdminCupScans';
import AdminSettings from './settings/AdminSettings';
import AdminHistory from './history/AdminHistory';
import AdminReports from './reports/AdminReports';
import AdminReceiptCheck from './receipts/AdminReceiptCheck';
import { useAdminDraft } from './hooks/useAdminDraft';
import './AdminApp.css';

export default function AdminApp() {
  const [page, setPage] = useState('overview');
  const draftState = useAdminDraft();

  function handlePreview() {
    window.open('/', '_blank');
  }

  return (
    <div className="admin-app">
      <AdminTopBar draftState={draftState} onPreview={handlePreview} />
      <div className="admin-app__body">
        <AdminSidebar
          activePage={page}
          onNavigate={setPage}
          draftState={draftState}
        />
        <main className="admin-app__main">
          {page === 'overview' && (
            <AdminOverview draftState={draftState} onNavigate={setPage} />
          )}
          {page === 'rewards' && (
            <AdminRewards draftState={draftState} />
          )}
          {page === 'users' && (
            <AdminUsers />
          )}
          {page === 'claims' && (
            <AdminClaims onNavigate={setPage} draftState={draftState} />
          )}
          {page === 'cupscans' && (
            <AdminCupScans />
          )}
          {page === 'settings' && (
            <AdminSettings draftState={draftState} />
          )}
          {page === 'history' && (
            <AdminHistory draftState={draftState} />
          )}
          {page === 'reports' && (
            <AdminReports />
          )}
          {page === 'receipts' && (
            <AdminReceiptCheck onNavigate={setPage} />
          )}
        </main>
      </div>
    </div>
  );
}
