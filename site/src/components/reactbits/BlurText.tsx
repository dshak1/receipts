// Adapted from the React Bits BlurText component.
// Source: https://reactbits.dev/text-animations/blur-text
import { motion } from "motion/react"

type BlurTextProps = { text: string; className?: string; delay?: number }
export function BlurText({ text, className = "", delay = 80 }: BlurTextProps) {
  const words = text.split(" ")
  return (
    <motion.span className={`inline-flex flex-wrap ${className}`} initial="hidden" whileInView="visible" viewport={{ once: true, amount: 0.35 }} variants={{ visible: { transition: { staggerChildren: delay / 1000 } } }}>
      {words.map((word, index) => (
        <motion.span key={`${word}-${index}`} className="mr-[0.28em] inline-block" variants={{ hidden: { opacity: 0, filter: "blur(10px)", y: 14 }, visible: { opacity: 1, filter: "blur(0px)", y: 0, transition: { duration: 0.62, ease: [0.22, 1, 0.36, 1] } } }}>{word}</motion.span>
      ))}
    </motion.span>
  )
}
