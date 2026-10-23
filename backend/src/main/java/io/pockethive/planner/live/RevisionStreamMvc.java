package io.pockethive.planner.live;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.AsyncHandlerInterceptor;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * Responsibility: bridge MVC emitter initialization and completion to the bounded transport.
 * Must not: schedule observers, send events or configure unrelated async request executors.
 * Contract: docs/ARCHITECTURE.md no unbounded emitter startup buffer or leaked subscriptions.
 */
@Configuration(proxyBeanMethods = false)
public class RevisionStreamMvc implements WebMvcConfigurer, AsyncHandlerInterceptor {
    private final RevisionStreams streams;

    public RevisionStreamMvc(RevisionStreams streams) {
        this.streams = streams;
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(this).addPathPatterns("/api/events");
    }

    @Override
    public void afterConcurrentHandlingStarted(HttpServletRequest request, HttpServletResponse response, Object handler) {
        streams.ready(request);
    }

    @Override
    public void afterCompletion(HttpServletRequest request, HttpServletResponse response, Object handler, Exception failure) {
        streams.release(request);
    }
}
