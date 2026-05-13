// ============================================================
// EMAIL SEND — Client Resend + fonctions d'envoi
// Règle : jamais de throw — l'email ne doit pas faire planter un run agent
// ============================================================

import { Resend } from 'resend'
import * as React from 'react'
import { WelcomeEmail } from './templates/welcome'

// ------------------------------------------------------------
// Client Resend (lazy singleton — ne crashe pas si RESEND_API_KEY est absent au chargement du module)
// ------------------------------------------------------------

let _resendClient: Resend | null = null

function getResendClient(): Resend {
  if (!_resendClient) {
    _resendClient = new Resend(process.env.RESEND_API_KEY)
  }
  return _resendClient
}

// ------------------------------------------------------------
// Types
// ------------------------------------------------------------

interface SendOptions {
  to: string
  subject: string
  react: React.ReactElement
}

interface SendResult {
  success: boolean
  id?: string
  error?: string
}

export interface SendWelcomeOptions {
  to: string
  userName: string
}

// ------------------------------------------------------------
// Fonction d'envoi principale (privée)
// Capture toutes les erreurs — jamais de throw
// ------------------------------------------------------------

async function sendEmail(options: SendOptions): Promise<SendResult> {
  const fromEmail = process.env.RESEND_FROM_EMAIL

  if (!fromEmail) {
    const error = 'RESEND_FROM_EMAIL non défini dans les variables d\'environnement'
    console.error(JSON.stringify({
      level: 'error',
      service: 'email',
      message: error,
      to: options.to,
    }))
    return { success: false, error }
  }

  if (!process.env.RESEND_API_KEY) {
    const error = 'RESEND_API_KEY non défini dans les variables d\'environnement'
    console.error(JSON.stringify({
      level: 'error',
      service: 'email',
      message: error,
      to: options.to,
    }))
    return { success: false, error }
  }

  try {
    const { data, error } = await getResendClient().emails.send({
      from: fromEmail,
      to: options.to,
      subject: options.subject,
      react: options.react,
    })

    if (error) {
      console.error(JSON.stringify({
        level: 'error',
        service: 'email',
        message: 'Erreur Resend lors de l\'envoi',
        to: options.to,
        subject: options.subject,
        resend_error: error,
      }))
      return { success: false, error: error.message }
    }

    return { success: true, id: data?.id }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Erreur inconnue lors de l\'envoi email'
    console.error(JSON.stringify({
      level: 'error',
      service: 'email',
      message: 'Exception inattendue lors de l\'envoi email',
      to: options.to,
      subject: options.subject,
      error: errorMessage,
    }))
    return { success: false, error: errorMessage }
  }
}

// ------------------------------------------------------------
// sendWelcomeEmail — email de bienvenue après inscription
// Appelé par le webhook Supabase Auth ou la route d'onboarding
// ------------------------------------------------------------

export async function sendWelcomeEmail(options: SendWelcomeOptions): Promise<{ success: boolean }> {
  const subject = 'Bienvenue sur DecarbonLeads — configurez votre agent en 3 minutes'

  const result = await sendEmail({
    to: options.to,
    subject,
    react: React.createElement(WelcomeEmail, {
      userName: options.userName,
    }),
  })

  return { success: result.success }
}
