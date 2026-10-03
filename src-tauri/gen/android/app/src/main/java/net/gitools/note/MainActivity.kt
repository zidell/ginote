package net.gitools.note

import android.graphics.Color
import android.os.Bundle
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  private lateinit var content: View

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    // Android 15부터 앱이 시스템 바 아래까지 그려진다. 웹 화면은 safe-area 값을 쓰지 않으므로
    // 상태 바·내비게이션 바·화면 컷아웃·키보드 영역만큼 WebView를 안쪽으로 들인다.
    content = findViewById(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
      val area = insets.getInsets(
        WindowInsetsCompat.Type.systemBars()
          or WindowInsetsCompat.Type.displayCutout()
          or WindowInsetsCompat.Type.ime()
      )
      view.setPadding(area.left, area.top, area.right, area.bottom)
      WindowInsetsCompat.CONSUMED
    }
    // 웹 앱의 기본 테마가 어두운 테마라 처음에는 어둡게 시작한다.
    applySystemBarTheme(true)
  }

  // 웹 앱이 테마를 적용할 때 GinoteAndroid.setTheme()으로 알려 준다(src/lib/settings-storage.js).
  override fun onWebViewCreate(webView: WebView) {
    webView.addJavascriptInterface(SystemBars(), "GinoteAndroid")
  }

  inner class SystemBars {
    @JavascriptInterface
    fun setTheme(dark: Boolean) {
      runOnUiThread { applySystemBarTheme(dark) }
    }
  }

  // 시스템 바 뒤로 보이는 여백을 웹 앱 배경색과 맞추고, 아이콘 색을 그 위에서 보이게 한다.
  private fun applySystemBarTheme(dark: Boolean) {
    content.setBackgroundColor(if (dark) Color.parseColor("#171717") else Color.WHITE)
    WindowCompat.getInsetsController(window, window.decorView).apply {
      isAppearanceLightStatusBars = !dark
      isAppearanceLightNavigationBars = !dark
    }
  }
}
