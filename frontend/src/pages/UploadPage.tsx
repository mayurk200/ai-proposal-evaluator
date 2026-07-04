import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Upload, FileText, X, CheckCircle, AlertTriangle,
  HardDrive, RefreshCw, ExternalLink, Loader2, Inbox,
} from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button, Card, Badge } from '@/components/ui';
import { uploadApi } from '@/services/proposal.service';
import { formatFileSize, formatDate } from '@/utils';

type Tab = 'upload' | 'files';

const ACCEPTED = {
  'application/pdf': ['.pdf'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
  'application/msword': ['.doc'],
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['.pptx'],
  'application/vnd.ms-powerpoint': ['.ppt'],
  'text/plain': ['.txt'],
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/tiff': ['.tiff'],
  'image/bmp': ['.bmp'],
};

export default function UploadPage() {
  const [tab, setTab] = useState<Tab>('upload');
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState('');
  const [justUploaded, setJustUploaded] = useState(0);
  const queryClient = useQueryClient();

  // All Files tab data — the list of everything currently in storage.
  const filesQuery = useQuery({
    queryKey: ['stored-files'],
    queryFn: uploadApi.list,
  });

  const uploadMut = useMutation({
    mutationFn: () => uploadApi.upload(files),
    onSuccess: (data) => {
      setJustUploaded(data.count);
      setFiles([]);
      setError('');
      queryClient.invalidateQueries({ queryKey: ['stored-files'] });
      setTab('files');
    },
    onError: (e: any) => {
      setError(
        e.response?.data?.error ||
        e.response?.data?.message ||
        e.message ||
        'Upload failed. Please try again.'
      );
    },
  });

  const onDrop = useCallback((accepted: File[]) => {
    if (accepted.length === 0) return;
    setError('');
    // Append newly picked files, de-duping by name+size so repeated drops don't stack.
    setFiles((prev) => {
      const seen = new Set(prev.map((f) => `${f.name}-${f.size}`));
      const merged = [...prev];
      accepted.forEach((f) => {
        const id = `${f.name}-${f.size}`;
        if (!seen.has(id)) {
          seen.add(id);
          merged.push(f);
        }
      });
      return merged;
    });
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPTED,
    maxSize: 52428800,
    multiple: true,
    maxFiles: 20,
  });

  const removeFile = (target: File) =>
    setFiles((prev) => prev.filter((f) => f !== target));

  const handleUpload = () => {
    if (files.length === 0) return;
    setJustUploaded(0);
    uploadMut.mutate();
  };

  const stored = filesQuery.data?.files ?? [];
  const storedCount = filesQuery.data?.count ?? stored.length;

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto space-y-8">
        {/* Header */}
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="text-2xl font-bold text-text">Proposal Files</h1>
          <p className="text-sm text-text-muted mt-1">
            Upload proposal documents to storage. Files are saved as-is — nothing is
            extracted or evaluated until you choose to.
          </p>
        </motion.div>

        {/* Tabs */}
        <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-accent/20 border border-border/50">
          <button
            onClick={() => setTab('upload')}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              tab === 'upload' ? 'bg-white shadow-sm text-primary' : 'text-text-muted hover:text-text'
            }`}
          >
            <Upload className="w-4 h-4" /> Upload
          </button>
          <button
            onClick={() => setTab('files')}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              tab === 'files' ? 'bg-white shadow-sm text-primary' : 'text-text-muted hover:text-text'
            }`}
          >
            <HardDrive className="w-4 h-4" /> All Files
            <span className="ml-0.5 inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-accent/50 text-[11px] font-semibold text-primary">
              {storedCount}
            </span>
          </button>
        </div>

        <AnimatePresence mode="wait">
          {/* ===== UPLOAD TAB ===== */}
          {tab === 'upload' && (
            <motion.div
              key="upload"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-6"
            >
              {/* Drop Zone */}
              <div {...getRootProps()} className={`upload-zone cursor-pointer ${isDragActive ? 'active' : ''}`}>
                <input {...getInputProps()} />
                <motion.div animate={isDragActive ? { scale: 1.05 } : { scale: 1 }}>
                  <div className="w-16 h-16 mx-auto rounded-2xl bg-accent/50 flex items-center justify-center mb-4">
                    <Upload className="w-7 h-7 text-primary/60" />
                  </div>
                  <p className="text-base font-medium text-text">
                    {isDragActive ? 'Drop files here' : 'Drag & drop proposals'}
                  </p>
                  <p className="text-sm text-text-muted mt-1">or click to browse</p>
                  <p className="text-xs text-text-muted mt-3">
                    Supports PDF, DOCX, DOC, PPTX, PPT, TXT, PNG, JPG, TIFF, BMP • Max 20 files • 50MB each
                  </p>
                </motion.div>
              </div>

              {/* Upload error */}
              {error && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                  <Card hover={false} className="border-red-200 bg-red-50/40 py-4">
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-semibold text-red-700">Upload failed</p>
                        <p className="text-sm text-red-600 mt-0.5">{error}</p>
                      </div>
                    </div>
                  </Card>
                </motion.div>
              )}

              {/* Selected files + upload action */}
              {files.length > 0 && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                  <Card hover={false} className="p-5">
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-sm font-semibold text-text">
                        {files.length} file{files.length > 1 ? 's' : ''} ready to upload
                      </p>
                      <button
                        onClick={() => setFiles([])}
                        className="text-xs text-text-muted hover:text-red-500 transition-colors"
                      >
                        Clear all
                      </button>
                    </div>
                    <div className="space-y-2">
                      {files.map((file) => (
                        <div
                          key={`${file.name}-${file.size}-${file.lastModified}`}
                          className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-white px-3 py-2"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="w-8 h-8 rounded-lg bg-accent/40 flex items-center justify-center flex-shrink-0">
                              <FileText className="w-4 h-4 text-primary" />
                            </div>
                            <p className="min-w-0 truncate text-sm text-text">
                              {file.name}
                              <span className="text-text-muted"> • {formatFileSize(file.size)}</span>
                            </p>
                          </div>
                          <button
                            onClick={() => removeFile(file)}
                            className="p-1 hover:bg-red-50 rounded-md flex-shrink-0"
                            aria-label={`Remove ${file.name}`}
                          >
                            <X className="w-3.5 h-3.5 text-text-muted" />
                          </button>
                        </div>
                      ))}
                    </div>
                    <div className="mt-4 pt-4 border-t border-border/50">
                      <Button onClick={handleUpload} className="w-full" size="lg" loading={uploadMut.isPending}>
                        {!uploadMut.isPending && <Upload className="w-5 h-5" />}
                        {uploadMut.isPending
                          ? 'Uploading to storage…'
                          : `Upload ${files.length} file${files.length > 1 ? 's' : ''} to storage`}
                      </Button>
                    </div>
                  </Card>
                </motion.div>
              )}
            </motion.div>
          )}

          {/* ===== ALL FILES TAB ===== */}
          {tab === 'files' && (
            <motion.div
              key="files"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-4"
            >
              {/* Upload success banner */}
              {justUploaded > 0 && (
                <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
                  <Card hover={false} className="border-green-200 bg-green-50/40 py-3.5">
                    <div className="flex items-center gap-3">
                      <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
                      <p className="text-sm font-medium text-green-800">
                        {justUploaded} file{justUploaded > 1 ? 's' : ''} uploaded to storage.
                      </p>
                    </div>
                  </Card>
                </motion.div>
              )}

              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-text">Files in storage</h2>
                  <p className="text-xs text-text-muted">
                    {storedCount} file{storedCount === 1 ? '' : 's'} stored
                  </p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => filesQuery.refetch()}
                  loading={filesQuery.isFetching}
                >
                  {!filesQuery.isFetching && <RefreshCw className="w-4 h-4" />} Refresh
                </Button>
              </div>

              {/* Loading */}
              {filesQuery.isLoading && (
                <Card hover={false} className="flex items-center justify-center gap-3 py-16">
                  <Loader2 className="w-5 h-5 animate-spin text-primary" />
                  <span className="text-sm text-text-muted">Loading files…</span>
                </Card>
              )}

              {/* Error */}
              {filesQuery.isError && !filesQuery.isLoading && (
                <Card hover={false} className="border-red-200 bg-red-50/40 text-center py-12">
                  <AlertTriangle className="w-10 h-10 text-red-400 mx-auto mb-3" />
                  <p className="text-sm font-semibold text-red-700">Couldn’t load files</p>
                  <p className="text-sm text-red-600 mt-1">
                    {(filesQuery.error as any)?.message || 'Please check the API and try again.'}
                  </p>
                  <Button variant="secondary" size="sm" className="mt-4" onClick={() => filesQuery.refetch()}>
                    <RefreshCw className="w-4 h-4" /> Retry
                  </Button>
                </Card>
              )}

              {/* Empty */}
              {!filesQuery.isLoading && !filesQuery.isError && stored.length === 0 && (
                <Card hover={false} className="text-center py-16">
                  <div className="w-14 h-14 mx-auto rounded-2xl bg-accent/40 flex items-center justify-center mb-4">
                    <Inbox className="w-7 h-7 text-primary/60" />
                  </div>
                  <p className="text-sm font-semibold text-text">No files in storage yet</p>
                  <p className="text-sm text-text-muted mt-1">Upload a proposal to see it listed here.</p>
                  <Button variant="secondary" size="sm" className="mt-4" onClick={() => setTab('upload')}>
                    <Upload className="w-4 h-4" /> Go to upload
                  </Button>
                </Card>
              )}

              {/* File list */}
              {!filesQuery.isLoading && !filesQuery.isError && stored.length > 0 && (
                <Card hover={false} className="overflow-hidden p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-border text-xs uppercase tracking-wide text-text-muted">
                          <th className="py-3 px-5 font-semibold">Name</th>
                          <th className="py-3 px-4 font-semibold">Size</th>
                          <th className="py-3 px-4 font-semibold">Uploaded</th>
                          <th className="py-3 px-5 font-semibold text-right">Open</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stored.map((file) => (
                          <tr key={file.key} className="border-b border-border/60 last:border-0 hover:bg-accent/5">
                            <td className="py-3 px-5 max-w-[320px]">
                              <div className="flex items-center gap-2.5 min-w-0">
                                <div className="w-8 h-8 rounded-lg bg-accent/40 flex items-center justify-center flex-shrink-0">
                                  <FileText className="w-4 h-4 text-primary" />
                                </div>
                                <span className="truncate font-medium text-text" title={file.name}>
                                  {file.name}
                                </span>
                              </div>
                            </td>
                            <td className="py-3 px-4 text-text-muted whitespace-nowrap">
                              {formatFileSize(file.size)}
                            </td>
                            <td className="py-3 px-4 text-text-muted whitespace-nowrap">
                              {file.lastModified ? formatDate(file.lastModified) : '—'}
                            </td>
                            <td className="py-3 px-5 text-right">
                              <a
                                href={file.url}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
                              >
                                Open <ExternalLink className="w-3.5 h-3.5" />
                              </a>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              )}

              {filesQuery.data?.note && (
                <div className="flex items-center gap-2">
                  <Badge variant="warning">Note</Badge>
                  <span className="text-xs text-text-muted">{filesQuery.data.note}</span>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </AppLayout>
  );
}
