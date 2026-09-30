import React, { useState, useEffect } from 'react';
import Dashboard from './pages/Dashboard';

function App() {
  const [findings, setFindings] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Load scanner output if it exists
    const loadFindings = async () => {
      try {
        const response = await fetch('./scanner-output.json');
        if (response.ok) {
          const data = await response.json();
          setFindings(data.findings || []);
        }
      } catch (error) {
        console.log('No scan data yet');
      }
    };

    loadFindings();
  }, []);

  return (
    <div className="min-h-screen bg-gray-50">
      <Dashboard findings={findings} loading={loading} />
    </div>
  );
}

export default App;
