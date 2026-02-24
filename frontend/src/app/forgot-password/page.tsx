'use client';

import {
  CognitoUser,
  CognitoUserPool,
  type ICognitoUserPoolData,
} from 'amazon-cognito-identity-js';
import Link from 'next/link';
import type { FormEvent } from 'react';
import { useState } from 'react';

import { frontendConfig } from '@/lib/config';

const createUserPool = () => {
  const poolData: ICognitoUserPoolData = {
    UserPoolId: frontendConfig.cognitoUserPoolId,
    ClientId: frontendConfig.cognitoClientId,
  };
  return new CognitoUserPool(poolData);
};

const createCognitoUser = (username: string) => {
  const userPool = createUserPool();
  return new CognitoUser({ Username: username, Pool: userPool });
};

export default function ForgotPasswordPage() {
  const [username, setUsername] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [requestStatus, setRequestStatus] = useState('');
  const [confirmStatus, setConfirmStatus] = useState('');
  const [requestError, setRequestError] = useState('');
  const [confirmError, setConfirmError] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [isRequesting, setIsRequesting] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);

  const requestReset = async (event: FormEvent) => {
    event.preventDefault();
    setRequestError('');
    setConfirmError('');
    setRequestStatus('');
    setIsRequesting(true);

    try {
      await new Promise<void>((resolve, reject) => {
        const cognitoUser = createCognitoUser(username.trim());
        cognitoUser.forgotPassword({
          onSuccess: () => resolve(),
          onFailure: (error) => reject(error),
          inputVerificationCode: () => resolve(),
        });
      });

      setCodeSent(true);
      setRequestStatus(
        'Reset instructions were sent to the email on file (Cognito may send a code or link depending on configuration).',
      );
    } catch {
      setRequestError('Password reset request failed. Verify the username/email and user pool settings.');
    } finally {
      setIsRequesting(false);
    }
  };

  const confirmReset = async (event: FormEvent) => {
    event.preventDefault();
    setConfirmError('');
    setConfirmStatus('');
    setIsConfirming(true);

    try {
      await new Promise<void>((resolve, reject) => {
        const cognitoUser = createCognitoUser(username.trim());
        cognitoUser.confirmPassword(verificationCode.trim(), newPassword, {
          onSuccess: () => resolve(),
          onFailure: (error) => reject(error),
        });
      });

      setConfirmStatus('Password updated. Return to sign in with your new password.');
    } catch {
      setConfirmError('Password reset confirmation failed. Check the verification code and password requirements.');
    } finally {
      setIsConfirming(false);
    }
  };

  return (
    <section>
      <h2>Reset password</h2>
      <p className="small">Request a password reset email for your account, then confirm the new password.</p>

      <div className="panel">
        <h3>1. Send reset email</h3>
        <form onSubmit={requestReset}>
          <label htmlFor="reset-username">Email or username</label>
          <input
            id="reset-username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            required
            autoComplete="username"
          />
          <div className="row">
            <button type="submit" disabled={isRequesting}>
              {isRequesting ? 'Sending...' : 'Send reset email'}
            </button>
            <Link href="/" className="button-link">
              Back to sign in
            </Link>
          </div>
          {requestStatus ? <p className="small">{requestStatus}</p> : null}
          {requestError ? <p>{requestError}</p> : null}
        </form>
      </div>

      <div className="panel">
        <h3>2. Confirm new password</h3>
        <p className="small">
          Use the verification code from your email. If your Cognito template sends a link, open the link and follow
          the hosted instructions.
        </p>
        <form onSubmit={confirmReset}>
          <label htmlFor="reset-code">Verification code</label>
          <input
            id="reset-code"
            value={verificationCode}
            onChange={(event) => setVerificationCode(event.target.value)}
            required
            autoComplete="one-time-code"
          />
          <label htmlFor="new-password">New password</label>
          <input
            id="new-password"
            type="password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            required
            autoComplete="new-password"
          />
          <div className="row">
            <button type="submit" disabled={isConfirming || !username.trim()}>
              {isConfirming ? 'Updating...' : 'Set new password'}
            </button>
            {!codeSent ? <span className="small">Send a reset email first.</span> : null}
          </div>
          {confirmStatus ? <p className="small">{confirmStatus}</p> : null}
          {confirmError ? <p>{confirmError}</p> : null}
        </form>
      </div>
    </section>
  );
}
