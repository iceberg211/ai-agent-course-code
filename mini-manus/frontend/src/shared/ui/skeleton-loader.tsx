import React from 'react'

interface SkeletonLoaderProps {
  className?: string
  style?: React.CSSProperties
}

export function SkeletonLoader({ className, style }: SkeletonLoaderProps) {
  return (
    <div className={`skeleton-loader ${className || ''}`} style={style}>
      <div 
        className="skeleton-title" 
        style={{ 
          width: '40%', 
          height: '24px', 
          background: 'rgba(0,0,0,0.06)', 
          borderRadius: '4px', 
          marginBottom: '16px' 
        }} 
      />
      <div 
        className="skeleton-line" 
        style={{ 
          width: '80%', 
          height: '16px', 
          background: 'rgba(0,0,0,0.04)', 
          borderRadius: '4px', 
          marginBottom: '12px' 
        }} 
      />
      <div 
        className="skeleton-line" 
        style={{ 
          width: '60%', 
          height: '16px', 
          background: 'rgba(0,0,0,0.04)', 
          borderRadius: '4px' 
        }} 
      />
    </div>
  )
}
