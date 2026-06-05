import { Routes, Route } from 'react-router-dom'
import { Layout } from './components/Layout'
import { Home } from './pages/Home'
import { Forms } from './pages/Forms'
import { Comments } from './pages/Comments'
import { Chat } from './pages/Chat'
import { Auth } from './pages/Auth'
import { Studio } from './pages/Studio'

function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="forms" element={<Forms />} />
        <Route path="comments" element={<Comments />} />
        <Route path="chat" element={<Chat />} />
        <Route path="auth" element={<Auth />} />
        <Route path="studio" element={<Studio />} />
        <Route path="*" element={<Home />} />
      </Route>
    </Routes>
  )
}

export default App
