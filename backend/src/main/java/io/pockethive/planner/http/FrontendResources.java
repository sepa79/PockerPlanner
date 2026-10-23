package io.pockethive.planner.http;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * Responsibility: expose only the built frontend assets and authored brand files.
 * Must not: expose filesystem paths, source maps, test fixtures or an API fallback.
 * Contract: docs/ARCHITECTURE.md classpath-only React delivery on the API listener.
 */
@Configuration(proxyBeanMethods = false)
public class FrontendResources implements WebMvcConfigurer {
    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        registry.addResourceHandler("/assets/**").addResourceLocations("classpath:/static/assets/");
        for (String asset : new String[]{"pocketplanner-logo.svg", "pocketplanner-topbar.svg", "pocketplanner-mark.svg"}) {
            registry.addResourceHandler("/" + asset).addResourceLocations("classpath:/static/");
        }
    }
}
