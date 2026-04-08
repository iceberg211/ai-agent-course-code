import { AppProviders } from '@/app/providers'
import { TaskCenterPage } from '@/pages/task-center'

function App() {
  return (
    <AppProviders>
      <TaskCenterPage />
    </AppProviders>
  )
}

export default App
