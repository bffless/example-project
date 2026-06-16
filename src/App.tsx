import { Routes, Route, Navigate } from 'react-router-dom'
import { Layout } from './components/Layout'
import { Home } from './pages/Home'
import { Forms } from './pages/Forms'
import { Comments } from './pages/Comments'
import { Chat } from './pages/Chat'
import { Auth } from './pages/Auth'
import { StudioProjects } from './pages/StudioProjects'
import { StudioProjectGuard } from './pages/StudioProjectGuard'

function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="forms" element={<Forms />} />
        <Route path="comments" element={<Comments />} />
        <Route path="chat" element={<Chat />} />
        <Route path="auth" element={<Auth />} />
        <Route path="studio">
          <Route index element={<StudioProjects />} />
          <Route path="project/:projectId" element={<StudioProjectGuard />} />
          <Route path="project/:projectId/:phase" element={<StudioProjectGuard />} />
          <Route path="*" element={<Navigate to="/studio" replace />} />
        </Route>
        <Route path="*" element={<Home />} />
      </Route>
    </Routes>
  )
}

export default App
