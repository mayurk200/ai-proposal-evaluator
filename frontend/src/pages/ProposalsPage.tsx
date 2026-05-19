import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { FileText, Search, Plus } from 'lucide-react';
import { useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, Button, Input, Badge, ScoreBadge, Skeleton } from '@/components/ui';
import { proposalApi } from '@/services/proposal.service';
import { formatDate, formatFileSize, getStatusColor } from '@/utils';

export default function ProposalsPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: ['proposals', page],
    queryFn: () => proposalApi.getAll(page, 10),
  });
  const filtered = data?.proposals?.filter(p => p.title.toLowerCase().includes(search.toLowerCase())) || [];
  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-text">Proposals</h1>
            <p className="text-sm text-text-muted mt-1">{data?.pagination?.total || 0} total proposals</p>
          </div>
          <Link to="/upload"><Button size="sm"><Plus className="w-4 h-4" /> Upload New</Button></Link>
        </div>
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <Input placeholder="Search proposals..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
        </div>
        {isLoading ? (
          <div className="space-y-4">{[1,2,3].map(i => <Card key={i} hover={false}><Skeleton className="h-16 w-full" /></Card>)}</div>
        ) : filtered.length === 0 ? (
          <Card hover={false} className="text-center py-16">
            <FileText className="w-12 h-12 text-text-muted mx-auto mb-3" />
            <p className="text-text-secondary">No proposals found</p>
            <Link to="/upload"><Button size="sm" className="mt-4">Upload Your First</Button></Link>
          </Card>
        ) : (
          <div className="space-y-3">
            {filtered.map((p, i) => (
              <motion.div key={p.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
                <Link to={`/proposals/${p.id}`}>
                  <Card className="p-5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="w-11 h-11 rounded-xl bg-accent/40 flex items-center justify-center">
                          <FileText className="w-5 h-5 text-primary" />
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-text">{p.title}</p>
                          <div className="flex items-center gap-3 mt-1 text-xs text-text-muted">
                            <span>{formatDate(p.createdAt)}</span>
                            <span>{formatFileSize(p.fileSize)}</span>
                            <span>{p.fileName}</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className={`text-xs px-2.5 py-1 rounded-lg font-medium ${getStatusColor(p.status)}`}>{p.status}</span>
                        {p.evaluation && <ScoreBadge score={p.evaluation.overallScore} />}
                      </div>
                    </div>
                    {p.evaluation && (
                      <p className="text-xs text-text-muted mt-3 line-clamp-1 pl-15">{p.evaluation.summary}</p>
                    )}
                  </Card>
                </Link>
              </motion.div>
            ))}
          </div>
        )}
        {data?.pagination && data.pagination.pages > 1 && (
          <div className="flex justify-center gap-2 pt-4">
            {Array.from({ length: data.pagination.pages }, (_, i) => (
              <button key={i} onClick={() => setPage(i + 1)} className={`w-9 h-9 rounded-lg text-sm font-medium transition-colors ${page === i + 1 ? 'gradient-primary text-white' : 'bg-white text-text-secondary hover:bg-accent-light'}`}>{i + 1}</button>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
