'use client'

// ============================================================
// StaggerChildren — wrapper Framer Motion qui anime ses enfants
// directs en cascade (stagger) au moment où le wrapper entre dans
// le viewport.
//
// Pattern LazyMotion strict : m.div / m.* uniquement.
// useReducedMotion() respecté (les enfants apparaissent sans délai
// ni translation).
//
// Usage :
//   <StaggerChildren>
//     <StaggerItem><Card1 /></StaggerItem>
//     <StaggerItem><Card2 /></StaggerItem>
//   </StaggerChildren>
//
// Le wrapper attend que ses enfants soient des éléments stylables
// (typiquement <StaggerItem>). On évite cloneElement pour rester
// strict et lisible.
// ============================================================

import {
  m,
  useReducedMotion,
  type HTMLMotionProps,
  type Variants,
} from 'motion/react'

interface StaggerChildrenProps extends HTMLMotionProps<'div'> {
  /** Délai entre chaque enfant en secondes. Défaut 0.08. */
  staggerDelay?: number
  /** Délai initial avant le 1er enfant. Défaut 0.05. */
  delayChildren?: number
}

export function StaggerChildren({
  staggerDelay = 0.08,
  delayChildren = 0.05,
  children,
  className,
  ...rest
}: StaggerChildrenProps) {
  const prefersReducedMotion = useReducedMotion() ?? false

  const variants: Variants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: prefersReducedMotion ? 0 : staggerDelay,
        delayChildren: prefersReducedMotion ? 0 : delayChildren,
      },
    },
  }

  return (
    <m.div
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, amount: 0.15 }}
      variants={variants}
      className={className}
      {...rest}
    >
      {children}
    </m.div>
  )
}

interface StaggerItemProps extends HTMLMotionProps<'div'> {
  /** Distance Y initiale en px. Défaut 24. */
  yOffset?: number
}

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 24 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] },
  },
}

export function StaggerItem({
  yOffset,
  children,
  className,
  ...rest
}: StaggerItemProps) {
  // Si yOffset custom est passé, on dérive une variante locale ; sinon on
  // utilise le default partagé (mémoïsé par module).
  const variants =
    yOffset === undefined
      ? itemVariants
      : ({
          hidden: { opacity: 0, y: yOffset },
          visible: {
            opacity: 1,
            y: 0,
            transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] },
          },
        } satisfies Variants)

  return (
    <m.div variants={variants} className={className} {...rest}>
      {children}
    </m.div>
  )
}
