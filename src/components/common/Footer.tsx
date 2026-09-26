import { useState, useEffect } from 'react';
import { getAppVersion } from '../../utils/version';

export function Footer() {
  const [version, setVersion] = useState('');
  useEffect(() => { getAppVersion().then(setVersion); }, []);
  return <footer className="studio-footer">
    <span>FIELDWORK {version && <span>/ {version}</span>} <span className="footer-separator">—</span> Your instruments. One workspace.</span>
    <span>Independent software · Not affiliated with teenage engineering. <a href="https://github.com/joseph-holland/op-patchstudio" target="_blank" rel="noopener noreferrer">Open-source credits ↗</a></span>
  </footer>;
}
