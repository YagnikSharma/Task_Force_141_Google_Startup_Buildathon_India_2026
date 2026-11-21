import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Lock, Mail, User, Phone, MapPin, AlertCircle, ArrowRight, Home, BadgeCheck, HeartHandshake, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { UserRole } from '../types';
import Mark from '../components/Mark';

export const AuthPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const initialMode = searchParams.get('mode') === 'register' ? 'register' : 'login';
  const [isRegister, setIsRegister] = useState<boolean>(initialMode === 'register');

  const { login, register, user } = useAuth();
  const [justSignedIn, setJustSignedIn] = useState(false);
  const navigate = useNavigate();

  // Form states
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<UserRole>('resident');
  const [address, setAddress] = useState('');
  const [emergencyNotes, setEmergencyNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Quick 1-click demo logins
  const handleDemoLogin = async (demoEmail: string) => {
    setError(null);
    setSubmitting(true);
    try {
      await login(demoEmail, 'Password123!');
      if (demoEmail.includes('responder')) {
        navigate('/responder');
      } else if (demoEmail.includes('admin')) {
        navigate('/admin');
      } else {
        navigate('/dashboard');
      }
    } catch (err: any) {
      setError(err.message || 'Demo sign-in failed. Please ensure the backend is running.');
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    if (!justSignedIn || !user) return;
    navigate(user.role === 'responder' ? '/responder' : user.role === 'admin' ? '/admin' : '/dashboard');
  }, [justSignedIn, user, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      if (isRegister) {
        await register({
          email,
          password,
          full_name: fullName,
          phone,
          role,
          address,
          emergency_notes: emergencyNotes,
        });
      } else {
        await login(email, password);
      }

      setJustSignedIn(true);
    } catch (err: any) {
      setError(err.message || 'Authentication failed. Please check your credentials.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-md mx-auto py-8 sm:py-12 px-4">
      <div className="text-center mb-6">
        <Mark className="w-14 h-14 mx-auto mb-4" />
        <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">
          {isRegister ? 'Join your neighbourhood network' : 'Welcome back'}
        </h1>
        <p className="text-sm text-slate-500 mt-1.5">
          {isRegister ? 'Residents and responders never pay.' : 'Sign in, or pick a demo account below.'}
        </p>
      </div>
      <div className="card overflow-hidden">

        {/* Tab Switcher */}
        <div className="flex gap-1 m-4 mb-0 p-1 rounded-full bg-slate-100">
          <button
            type="button"
            onClick={() => { setIsRegister(false); setError(null); }}
            className={`flex-1 py-2 rounded-full text-sm font-semibold transition ${!isRegister ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={() => { setIsRegister(true); setError(null); }}
            className={`flex-1 py-2 rounded-full text-sm font-semibold transition ${isRegister ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
          >
            Register
          </button>
        </div>

        <div className="p-6">
          {error && (
            <div className="mb-5 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* One-click demo accounts (for judges and first-time visitors) */}
          {!isRegister && (
            <div className="mb-6">
              <span className="text-xs font-semibold text-slate-500 block mb-2">One-click demo accounts</span>
              <div className="grid grid-cols-2 gap-2">
                {([
                  ['resident@neighbourhood.org', 'Resident', 'Priya Sharma', Home, 'text-brand-600 bg-brand-50'],
                  ['responder@neighbourhood.org', 'Responder', 'Insp. Vikram Joshi', BadgeCheck, 'text-green-600 bg-green-50'],
                  ['elder.ramesh@neighbourhood.org', 'Senior citizen', 'Col. Ramesh Varma', HeartHandshake, 'text-amber-600 bg-amber-50'],
                  ['admin@neighbourhood.org', 'Admin', 'Operations centre', ShieldCheck, 'text-violet-600 bg-violet-50'],
                ] as const).map(([mail, roleLabel, name, Icon, tone]) => (
                  <button
                    key={mail}
                    type="button"
                    disabled={submitting}
                    onClick={() => handleDemoLogin(mail)}
                    className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-white p-2.5 text-left transition hover:border-brand-300 hover:bg-brand-50/40 active:scale-[0.98] disabled:opacity-60"
                  >
                    <span className={`grid place-items-center w-9 h-9 shrink-0 rounded-lg ${tone}`}><Icon className="w-[18px] h-[18px]" /></span>
                    <span className="min-w-0 leading-tight">
                      <span className="block text-[11px] font-medium text-slate-500">{roleLabel}</span>
                      <span className="block text-[13px] font-semibold text-slate-800 truncate">{name}</span>
                    </span>
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-3 mt-5 text-[11px] text-slate-400">
                <span className="h-px flex-1 bg-slate-200" /> or sign in with email <span className="h-px flex-1 bg-slate-200" />
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            
            {isRegister && (
              <>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Full Name</label>
                  <div className="relative">
                    <User className="w-4 h-4 text-slate-400 absolute left-3 top-3.5" />
                    <input
                      type="text"
                      required
                      placeholder="e.g. Maya Sen"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      className="w-full pl-9 pr-3 py-2.5 text-sm border border-slate-300 rounded-xl bg-white focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 outline-none transition"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Account Role</label>
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value as UserRole)}
                    className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-xl bg-white focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 outline-none transition bg-white"
                  >
                    <option value="resident">Resident / Citizen</option>
                    <option value="responder">Community Responder (Patrol / Medical)</option>
                    <option value="guardian">Family Guardian / Caregiver</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Phone Number</label>
                  <div className="relative">
                    <Phone className="w-4 h-4 text-slate-400 absolute left-3 top-3.5" />
                    <input
                      type="tel"
                      placeholder="+91 98765 00000"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="w-full pl-9 pr-3 py-2.5 text-sm border border-slate-300 rounded-xl bg-white focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 outline-none transition"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Home Address / Sector</label>
                  <div className="relative">
                    <MapPin className="w-4 h-4 text-slate-400 absolute left-3 top-3.5" />
                    <input
                      type="text"
                      placeholder="House/Apartment #, Sector"
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      className="w-full pl-9 pr-3 py-2.5 text-sm border border-slate-300 rounded-xl bg-white focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 outline-none transition"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Emergency Notes <span className="text-slate-400 font-normal">(Allergies, Blood Group, Inhaler)</span>
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Asthma, Blood Group O+"
                    value={emergencyNotes}
                    onChange={(e) => setEmergencyNotes(e.target.value)}
                    className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-xl bg-white focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 outline-none transition"
                  />
                </div>
              </>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Email Address</label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-3.5" />
                <input
                  type="email"
                  required
                  placeholder="resident@neighbourhood.org"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-9 pr-3 py-2.5 text-sm border border-slate-300 rounded-xl bg-white focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 outline-none transition"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Password</label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-3.5" />
                <input
                  type="password"
                  required
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-9 pr-3 py-2.5 text-sm border border-slate-300 rounded-xl bg-white focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 outline-none transition"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="btn-primary w-full mt-4 !py-3 !rounded-xl"
            >
              {submitting ? 'Authenticating...' : isRegister ? 'Complete Registration' : 'Sign In'}
              <ArrowRight className="w-4 h-4" />
            </button>

          </form>
        </div>

      </div>
    </div>
  );
};
