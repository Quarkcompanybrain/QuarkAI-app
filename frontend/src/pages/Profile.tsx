import { useRef, useState, type FormEvent } from 'react';
import { authApi } from '../features/auth/api';
import { useAuthStore } from '../store/authStore';
import { Card } from '../components/Card';
import { Input } from '../components/Input';
import { Button } from '../components/Button';
import { ErrorBanner } from '../components/ErrorBanner';
import { ApiRequestError } from '../lib/api';

export function Profile() {
  const { user, setUser } = useAuthStore();
  const [name, setName] = useState(user?.name || '');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const initials = (user?.name || user?.email || '?').trim().charAt(0).toUpperCase();

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaved(false);
    setSaving(true);
    try {
      const res = await authApi.updateProfile(name);
      setUser(res.user);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Something went wrong.');
    } finally {
      setSaving(false);
    }
  };

  const handleAvatarChange = async (fileList: FileList | null) => {
    const file = fileList?.[0];
    if (!file) return;
    setError(null);
    setUploadingAvatar(true);
    try {
      const res = await authApi.uploadAvatar(file);
      setUser(res.user);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not upload image.');
    } finally {
      setUploadingAvatar(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-6">
      <h1 className="font-display text-2xl font-semibold text-ink">Profile</h1>
      <p className="mt-1 text-sm text-neutral-500">Manage your personal account details.</p>

      <div className="mt-6 flex max-w-3xl flex-col gap-5">
        <Card>
          <div className="flex items-center gap-4">
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingAvatar}
              aria-label="Change profile picture"
              className="group relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-magenta-gradient text-lg font-semibold text-white shadow-sm"
            >
              {user?.avatarUrl ? (
                <img src={user.avatarUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                initials
              )}
              <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-xs font-medium text-white opacity-0 transition-opacity group-hover:opacity-100">
                {uploadingAvatar ? '…' : 'Change'}
              </span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              className="hidden"
              onChange={(e) => handleAvatarChange(e.target.files)}
            />
            <div>
              <h2 className="font-display text-lg font-semibold text-ink">Account</h2>
              <p className="mt-1 text-sm text-neutral-500">{user?.email}</p>
            </div>
          </div>
        </Card>

        <Card>
          <h2 className="mb-4 font-display text-lg font-semibold text-ink">Personal details</h2>
          <form onSubmit={handleSave} className="flex items-end gap-2">
            <div className="flex-1">
              <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <Button type="submit" loading={saving}>
              Save changes
            </Button>
          </form>
          <ErrorBanner message={error} />
          {saved && <p className="mt-3 text-sm text-magenta-600">Saved.</p>}
        </Card>
      </div>
    </div>
  );
}
